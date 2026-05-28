import Foundation
import Capacitor
import CoreBluetooth
import AVFoundation

@objc(BLEPeripheralPlugin)
public class BLEPeripheralPlugin: CAPPlugin, CBPeripheralManagerDelegate {

    private var peripheralManager: CBPeripheralManager?
    private var audioCharacteristic: CBMutableCharacteristic?
    private var connectedCentrals: Set<String> = []
    private var pendingStartCall: CAPPluginCall?
    private var serviceAdded = false

    private let GLOBOAIR_SERVICE_UUID = "47410000-0000-1000-8000-00805f9b34fb"
    private let AUDIO_CHAR_UUID       = "47410001-0000-1000-8000-00805f9b34fb"

    @objc func requestMicPermission(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            call.resolve(["granted": granted])
        }
    }

    // Audio capture nativo iOS (AVAudioEngine)
    private var audioEngine: AVAudioEngine? = nil
    private var isAudioCapturing = false

    @objc func startAudioCapture(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setPreferredSampleRate(8000)
            try session.setActive(true)
        } catch {
            call.reject("AVAudioSession error: \(error.localizedDescription)")
            return
        }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 8000, channels: 1, interleaved: true)
            ?? input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            guard self.isAudioCapturing,
                  let channelData = buffer.int16ChannelData else { return }
            let frameCount = Int(buffer.frameLength)
            var pcm8 = [UInt8](repeating: 0, count: frameCount)
            for i in 0..<frameCount {
                let sample = Int(channelData[0][i])
                pcm8[i] = UInt8(max(0, min(255, (sample + 32768) >> 8)))
            }
            let data = Data(pcm8)
            let b64 = data.base64EncodedString()
            self.notifyListeners("audioChunk", data: ["data": b64])
        }

        do {
            try engine.start()
            self.audioEngine = engine
            self.isAudioCapturing = true
            call.resolve()
        } catch {
            call.reject("AVAudioEngine start error: \(error.localizedDescription)")
        }
    }

    @objc func stopAudioCapture(_ call: CAPPluginCall) {
        isAudioCapturing = false
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        call.resolve()
    }

    @objc func initialize(_ call: CAPPluginCall) {
        peripheralManager = CBPeripheralManager(delegate: self, queue: .main, options: [
            CBPeripheralManagerOptionShowPowerAlertKey: true
        ])
        call.resolve()
    }

    @objc func startAdvertising(_ call: CAPPluginCall) {
        guard let pm = peripheralManager else {
            call.reject("Chiama initialize() prima")
            return
        }
        switch pm.state {
        case .poweredOn:
            _startAdvertising(call: call)
        case .unknown, .resetting:
            // Stato transitorio: aspetta il callback
            pendingStartCall = call
        case .poweredOff:
            call.reject("Bluetooth è spento — attivalo in Impostazioni")
        case .unauthorized:
            call.reject("Permesso Bluetooth negato — vai in Impostazioni → GloboAir → Bluetooth")
        case .unsupported:
            call.reject("Bluetooth non supportato su questo dispositivo")
        @unknown default:
            call.reject("Bluetooth non disponibile")
        }
    }

    private func _startAdvertising(call: CAPPluginCall) {
        guard let pm = peripheralManager else { return }

        let serviceUUID = CBUUID(string: GLOBOAIR_SERVICE_UUID)
        let audioCharUUID = CBUUID(string: AUDIO_CHAR_UUID)

        audioCharacteristic = CBMutableCharacteristic(
            type: audioCharUUID,
            properties: [.notify, .read],
            value: nil,
            permissions: [.readable]
        )

        if !serviceAdded {
            let service = CBMutableService(type: serviceUUID, primary: true)
            service.characteristics = [audioCharacteristic!]
            pm.add(service)
            serviceAdded = true
        }

        pm.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: call.getString("localName") ?? "GloboAir"
        ])

        call.resolve()
    }

    @objc func stopAdvertising(_ call: CAPPluginCall) {
        peripheralManager?.stopAdvertising()
        serviceAdded = false
        connectedCentrals.removeAll()
        call.resolve()
    }

    @objc func sendNotification(_ call: CAPPluginCall) {
        guard
            let pm = peripheralManager,
            let char = audioCharacteristic,
            let valueB64 = call.getString("value"),
            let data = Data(base64Encoded: valueB64)
        else {
            call.reject("Invalid parameters")
            return
        }
        let sent = pm.updateValue(data, for: char, onSubscribedCentrals: nil)
        call.resolve(["sent": sent])
    }

    @objc func getConnectedCentralsCount(_ call: CAPPluginCall) {
        call.resolve(["count": connectedCentrals.count])
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        let stateMap: [CBManagerState: String] = [
            .unknown: "unknown", .resetting: "resetting",
            .unsupported: "unsupported", .unauthorized: "unauthorized",
            .poweredOff: "poweredOff", .poweredOn: "poweredOn"
        ]
        let stateStr = stateMap[peripheral.state] ?? "unknown"
        notifyListeners("stateChange", data: ["state": stateStr])

        guard let pending = pendingStartCall else { return }
        pendingStartCall = nil

        switch peripheral.state {
        case .poweredOn:
            _startAdvertising(call: pending)
        case .poweredOff:
            pending.reject("Bluetooth è spento — attivalo in Impostazioni")
        case .unauthorized:
            pending.reject("Permesso Bluetooth negato — vai in Impostazioni → GloboAir → Bluetooth")
        case .unsupported:
            pending.reject("Bluetooth non supportato su questo dispositivo")
        default:
            // resetting: rimetti in attesa e riprova
            pendingStartCall = pending
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                   central: CBCentral,
                                   didSubscribeTo characteristic: CBCharacteristic) {
        let id = central.identifier.uuidString
        connectedCentrals.insert(id)
        notifyListeners("centralConnected", data: ["id": id, "count": connectedCentrals.count])
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                   central: CBCentral,
                                   didUnsubscribeFrom characteristic: CBCharacteristic) {
        let id = central.identifier.uuidString
        connectedCentrals.remove(id)
        notifyListeners("centralDisconnected", data: ["id": id, "count": connectedCentrals.count])
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        notifyListeners("readyToSend", data: [:])
    }
}
