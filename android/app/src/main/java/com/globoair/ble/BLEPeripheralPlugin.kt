package com.globoair.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Base64
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID

/**
 * BLEPeripheralPlugin — Android BluetoothLeAdvertiser + GattServer
 *
 * Permette al telefono del broadcaster di agire come GATT Peripheral:
 *   - BluetoothLeAdvertiser: rende il telefono visibile agli scanner
 *   - BluetoothGattServer: serve la Audio Characteristic con Notify
 *
 * Permissions in AndroidManifest.xml:
 *   BLUETOOTH_ADVERTISE (API 31+)
 *   BLUETOOTH_CONNECT   (API 31+)
 *   BLUETOOTH_SCAN      (API 31+)
 *   ACCESS_FINE_LOCATION (API < 31)
 */
@CapacitorPlugin(name = "BLEPeripheral")
class BLEPeripheralPlugin : Plugin() {

    companion object {
        val SERVICE_UUID: UUID = UUID.fromString("47410000-0000-1000-8000-00805f9b34fb")
        val AUDIO_CHAR_UUID: UUID = UUID.fromString("47410001-0000-1000-8000-00805f9b34fb")
        val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    private var audioCharacteristic: BluetoothGattCharacteristic? = null
    private val subscribedDevices = mutableSetOf<BluetoothDevice>()

    // ─── Plugin methods ───────────────────────────────────────────────────────

    @PluginMethod
    fun initialize(call: PluginCall) {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth non disponibile")
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val adapter = bluetoothAdapter ?: return call.reject("Non inizializzato")
        if (!adapter.isEnabled) return call.reject("Bluetooth spento")

        _startGattServer()

        advertiser = adapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()

        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .setIncludeDeviceName(true)
            .build()

        advertiser?.startAdvertising(settings, data, advertiseCallback)
        call.resolve()
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        advertiser?.stopAdvertising(advertiseCallback)
        gattServer?.close()
        gattServer = null
        subscribedDevices.clear()
        call.resolve()
    }

    @PluginMethod
    fun sendNotification(call: PluginCall) {
        val valueB64 = call.getString("value") ?: return call.reject("Valore mancante")
        val data = Base64.decode(valueB64, Base64.DEFAULT)
        val char = audioCharacteristic ?: return call.reject("Server non avviato")

        char.value = data
        var allSent = true
        for (device in subscribedDevices) {
            val sent = gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
            if (sent != true) allSent = false
        }
        call.resolve(JSObject().put("sent", allSent))
    }

    @PluginMethod
    fun getConnectedCentralsCount(call: PluginCall) {
        call.resolve(JSObject().put("count", subscribedDevices.size))
    }

    // ─── GATT Server ──────────────────────────────────────────────────────────

    private fun _startGattServer() {
        val manager = bluetoothManager ?: return

        val audioChar = BluetoothGattCharacteristic(
            AUDIO_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        // Descriptor per client configuration (subscribe to notifications)
        val descriptor = BluetoothGattDescriptor(
            CLIENT_CONFIG_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        audioChar.addDescriptor(descriptor)
        audioCharacteristic = audioChar

        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(audioChar)

        gattServer = manager.openGattServer(context, gattServerCallback)
        gattServer?.addService(service)
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor, preparedWrite: Boolean,
            responseNeeded: Boolean, offset: Int, value: ByteArray
        ) {
            if (descriptor.uuid == CLIENT_CONFIG_UUID) {
                if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    subscribedDevices.add(device)
                    notifyListeners("centralConnected", JSObject()
                        .put("id", device.address)
                        .put("count", subscribedDevices.size))
                } else {
                    subscribedDevices.remove(device)
                    notifyListeners("centralDisconnected", JSObject()
                        .put("id", device.address)
                        .put("count", subscribedDevices.size))
                }
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
                }
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                subscribedDevices.remove(device)
                notifyListeners("centralDisconnected", JSObject()
                    .put("id", device.address)
                    .put("count", subscribedDevices.size))
            }
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            notifyListeners("advertisingStarted", JSObject())
        }
        override fun onStartFailure(errorCode: Int) {
            notifyListeners("advertisingFailed", JSObject().put("error", errorCode))
        }
    }
}
