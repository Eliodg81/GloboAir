#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BLEPeripheralPlugin, "BLEPeripheral",
  CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(requestMicPermission, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(sendNotification, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getConnectedCentralsCount, CAPPluginReturnPromise);
)
