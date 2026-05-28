package com.globoup.globoair;

import android.webkit.PermissionRequest;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.globoair.ble.BLEPeripheralPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registra il plugin BLEPeripheral custom
        registerPlugin(BLEPeripheralPlugin.class);
        super.onCreate(savedInstanceState);

        // Permetti al WebView di usare il microfono per la Web Speech API
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Concedi tutti i permessi richiesti dal WebView (microfono, camera, ecc.)
                request.grant(request.getResources());
            }
        });
    }
}
