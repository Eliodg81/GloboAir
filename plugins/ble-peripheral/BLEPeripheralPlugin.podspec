Pod::Spec.new do |s|
  s.name             = 'BLEPeripheralPlugin'
  s.version          = '0.0.1'
  s.summary          = 'GloboAir BLE Peripheral Plugin for iOS'
  s.description      = 'Native CBPeripheralManager + AVAudioEngine plugin for GloboAir'
  s.homepage         = 'https://github.com/Eliodg81/GloboAir'
  s.license          = { :type => 'MIT' }
  s.author           = { 'GloboAir' => 'info@globoair.app' }
  s.source           = { :git => '.', :tag => s.version.to_s }
  s.ios.deployment_target = '14.0'
  s.source_files     = 'ios/**/*.{swift,m,h}'
  s.swift_version    = '5.1'
  s.dependency 'Capacitor'
end
