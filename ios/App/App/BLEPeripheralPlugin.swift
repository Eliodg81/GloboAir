import Foundation
import Capacitor
import CoreBluetooth

@objc(BLEPeripheralPlugin)
public class BLEPeripheralPlugin: CAPPlugin, CBPeripheralManagerDelegate {

    private var peripheralManager: CBPeripheralManager?
    private var audioCharacteristic: CBMutableCharacteristic?
    private var connectedCentrals: Set<String> = []
    private var pendingStartCall: CAPPluginCall?
    private var serviceAdded = false

    private let GLOBOAIR_SERVICE_UUID = "47410000-0000-1000-8000-00805f9b34fb"
    private let AUDIO_CHAR_UUID       = "47410001-0000-1000-8000-00805f9b34fb"

    @objc func initialize(_ call: CAPPluginCall) {
        peripheralManager = CBPeripheralManager(delegate: self, queue: .main, options: [
            CBPeripheralManagerOptionShowPowerAlertKey: true
        ])
        call.resolve()
    }

    @objc func startAdvertising(_ call: CAPPluginCall) {
        guard let pm = peripheralManager else {
            call.reject("Not initialized")
            return
        }
        if pm.state != .poweredOn {
            pendingStartCall = call
            return
        }
        _startAdvertising(call: call)
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
        notifyListeners("stateChange", data: ["state": stateMap[peripheral.state] ?? "unknown"])

        if peripheral.state == .poweredOn, let pending = pendingStartCall {
            pendingStartCall = nil
            _startAdvertising(call: pending)
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
