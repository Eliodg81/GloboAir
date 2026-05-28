#!/bin/bash
# GloboAir — setup iOS sul Mac
# Esegui con: bash setup-ios.sh

set -e
cd ~/GloboAir

echo "📦 npm install..."
npm install

echo "🔨 Build web..."
npm run build

echo "📱 Sync Capacitor iOS..."
npx cap sync ios

echo "🍫 Pod install..."
cd ios/App
pod install
cd ../..

echo "✅ Fatto! Apertura Xcode..."
npx cap open ios

echo ""
echo "In Xcode:"
echo "  1. Aggiungi BLEPeripheralPlugin.swift e BLEPeripheralPlugin+Registration.m al target App (se non ci sono)"
echo "  2. ⇧⌘K  →  Clean Build Folder"
echo "  3. ⌘R   →  Run"
