package com.globoair.ble

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.app.ActivityCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

@CapacitorPlugin(
    name = "BLEPeripheral",
    permissions = [
        Permission(
            alias = "bluetooth",
            strings = [
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
            ]
        ),
        Permission(
            alias = "location",
            strings = [Manifest.permission.ACCESS_FINE_LOCATION]
        ),
        Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO]
        ),
    ]
)
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

    // Saved call per il callback dopo permessi
    private var pendingStartCall: PluginCall? = null

    // ─── initialize ──────────────────────────────────────────────────────────

    @PluginMethod
    fun initialize(call: PluginCall) {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth non disponibile su questo dispositivo")
            return
        }
        if (!bluetoothAdapter!!.isEnabled) {
            call.reject("Bluetooth spento — attivalo dalle impostazioni")
            return
        }
        call.resolve()
    }

    // ─── startAdvertising — richiede permessi, poi avvia ─────────────────────

    // ─── requestMicPermission ────────────────────────────────────────────────
    // Richiede RECORD_AUDIO a runtime prima che getUserMedia venga chiamato dal JS

    @PluginMethod
    fun requestMicPermission(call: PluginCall) {
        val granted = ActivityCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("microphone", call, "micPermissionCallback")
        }
    }

    @PermissionCallback
    private fun micPermissionCallback(call: PluginCall) {
        val granted = ActivityCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            call.resolve(JSObject().put("granted", true))
        } else {
            call.reject("Permesso microfono negato")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val adapter = bluetoothAdapter ?: return call.reject("Non inizializzato — chiama initialize() prima")
        if (!adapter.isEnabled) return call.reject("Bluetooth spento")

        // Su Android 12+ le permission BLE vanno richieste a runtime
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val needAdvertise = ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED
            val needConnect   = ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)   != PackageManager.PERMISSION_GRANTED

            if (needAdvertise || needConnect) {
                pendingStartCall = call
                requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback")
                return
            }
        } else {
            // API < 31: serve ACCESS_FINE_LOCATION
            val needLocation = ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            if (needLocation) {
                pendingStartCall = call
                requestPermissionForAlias("location", call, "bluetoothPermissionCallback")
                return
            }
        }

        // Tutte le permission ok — avvia
        _doStartAdvertising(call)
    }

    @PermissionCallback
    private fun bluetoothPermissionCallback(call: PluginCall) {
        val permCall = pendingStartCall ?: call
        pendingStartCall = null

        // Verifica che le permission siano state concesse
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val granted = ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
                          ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)   == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                permCall.reject("Permessi Bluetooth negati — abilita Bluetooth nelle impostazioni dell'app")
                return
            }
        }

        _doStartAdvertising(permCall)
    }

    private fun _doStartAdvertising(call: PluginCall) {
        try {
            _startGattServer()

            advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
            if (advertiser == null) {
                call.reject("BLE advertising non supportato su questo dispositivo")
                return
            }

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build()

            // Pacchetto principale: solo Service UUID (18 byte) → iOS lo trova col filtro
            val data = AdvertiseData.Builder()
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .setIncludeDeviceName(false)
                .build()

            // Scan response: nome dispositivo (non usato da iOS per il filtro, ma visibile dopo)
            val scanResponse = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .build()

            advertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
            call.resolve()
        } catch (e: SecurityException) {
            call.reject("Permesso Bluetooth negato: ${e.message}")
        } catch (e: Exception) {
            call.reject("Errore avvio advertising: ${e.message}")
        }
    }

    // ─── stopAdvertising ─────────────────────────────────────────────────────

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (e: SecurityException) { /* ignora */ }
        gattServer?.close()
        gattServer = null
        subscribedDevices.clear()
        call.resolve()
    }

    // ─── sendNotification ────────────────────────────────────────────────────

    @PluginMethod
    fun sendNotification(call: PluginCall) {
        val valueB64 = call.getString("value") ?: return call.reject("Valore mancante")
        val data = Base64.decode(valueB64, Base64.DEFAULT)
        val char = audioCharacteristic ?: return call.reject("Server GATT non avviato")

        char.value = data
        var allSent = true
        for (device in subscribedDevices.toList()) {
            try {
                val sent = gattServer?.notifyCharacteristicChanged(device, char, false)
                if (sent != true) allSent = false
            } catch (e: SecurityException) {
                allSent = false
            }
        }
        call.resolve(JSObject().put("sent", allSent))
    }

    // ─── getConnectedCentralsCount ───────────────────────────────────────────

    @PluginMethod
    fun getConnectedCentralsCount(call: PluginCall) {
        call.resolve(JSObject().put("count", subscribedDevices.size))
    }

    // ─── GATT Server interno ─────────────────────────────────────────────────

    private fun _startGattServer() {
        val manager = bluetoothManager ?: return

        val audioChar = BluetoothGattCharacteristic(
            AUDIO_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
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
                    try {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
                    } catch (e: SecurityException) { /* ignora */ }
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
