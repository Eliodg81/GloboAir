import Foundation
import Capacitor
import CoreBluetooth

/**
 * BLEPeripheralPlugin — iOS CoreBluetooth Peripheral Manager
 *
 * Permette al telefono del broadcaster di agire come GATT Server:
 *   - Crea il servizio GloboAir con una Audio Characteristic
 *   - Fa advertising (visibile agli scanner BLE nelle vicinanze)
 *   - Invia notifiche audio ai Central connessi
 *
 * Info.plist richiesto:
 *   NSBluetoothAlwaysUsageDescription
 *   NSBluetoothPeripheralUsageDescription
 *   UIBackgroundModes: bluetooth-peripheral
 */
@objc(BLEPeripheralPlugin)
public class BLEPeripheralPlugin: CAPPlugin, CBPeripheralManagerDelegate {

    // MARK: - Properties

    private var peripheralManager: CBPeripheralManager?
    private var audioCharacteristic: CBMutableCharacteristic?
    private var connectedCentrals: Set<String> = []
    private var pendingStartCall: CAPPluginCall?
    private var serviceAdded = false

    // MARK: - Plugin Methods

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

        // Crea caratteristica audio (Notify + Read)
        audioCharacteristic = CBMutableCharacteristic(
            type: audioCharUUID,
            properties: [.notify, .read],
            value: nil,
            permissions: [.readable]
        )

        // Aggiungi servizio
        if !serviceAdded {
            let service = CBMutableService(type: serviceUUID, primary: true)
            service.characteristics = [audioCharacteristic!]
            pm.add(service)
            serviceAdded = true
        }

        // Avvia advertising
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

        // updateValue ritorna false se la coda interna è piena → ignorare per ora
        // In produzione: implementare coda con didIsReadyToUpdateSubscribers
        let sent = pm.updateValue(data, for: char, onSubscribedCentrals: nil)
        if !sent {
            // Coda piena — il pacchetto viene droppato in questa versione PoC
            // TODO: implementare retry queue
        }
        call.resolve(["sent": sent])
    }

    @objc func getConnectedCentralsCount(_ call: CAPPluginCall) {
        call.resolve(["count": connectedCentrals.count])
    }

    // MARK: - CBPeripheralManagerDelegate

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        let stateMap: [CBManagerState: String] = [
            .unknown: "unknown", .resetting: "resetting",
            .unsupported: "unsupported", .unauthorized: "unauthorized",
            .poweredOff: "poweredOff", .poweredOn: "poweredOn"
        ]
        notifyListeners("stateChange", data: ["state": stateMap[peripheral.state] ?? "unknown"])

        // Se c'era una chiamata startAdvertising in attesa, eseguila ora
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
        print("[BLEPeripheral] Central subscribed: \(id) — total: \(connectedCentrals.count)")
        notifyListeners("centralConnected", data: [
            "id": id,
            "count": connectedCentrals.count
        ])
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                   central: CBCentral,
                                   didUnsubscribeFrom characteristic: CBCharacteristic) {
        let id = central.identifier.uuidString
        connectedCentrals.remove(id)
        print("[BLEPeripheral] Central unsubscribed: \(id) — total: \(connectedCentrals.count)")
        notifyListeners("centralDisconnected", data: [
            "id": id,
            "count": connectedCentrals.count
        ])
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        // Notifica JS che la coda è libera — per implementazione retry
        notifyListeners("readyToSend", data: [:])
    }

    // MARK: - Constants

    private let GLOBOAIR_SERVICE_UUID = "47410000-0000-1000-8000-00805f9b34fb"
    private let AUDIO_CHAR_UUID       = "47410001-0000-1000-8000-00805f9b34fb"
}
