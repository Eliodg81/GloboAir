package com.globoup.globoair;

import com.getcapacitor.BridgeActivity;
import com.globoair.ble.BLEPeripheralPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registra il plugin BLEPeripheral custom
        registerPlugin(BLEPeripheralPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
