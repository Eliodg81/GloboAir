#import <Capacitor/Capacitor.h>

// Registra il plugin BLEPeripheral con Capacitor (Objective-C bridge)
CAP_PLUGIN(BLEPeripheralPlugin, "BLEPeripheral",
  CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(sendNotification, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getConnectedCentralsCount, CAPPluginReturnPromise);
)
