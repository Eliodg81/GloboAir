# GloboAir — Guida al test su dispositivo fisico

## Requisiti
- Mac con Xcode 15+ (per iOS)
- Android Studio (per Android)
- 2 smartphone fisici (iPhone o Android)
- Cavo USB

---

## iOS (richiede Mac)

### 1. Sincronizza il progetto
```bash
cd GloboAir
npm run build
npx cap sync ios
```

### 2. Apri in Xcode
```bash
npx cap open ios
```

### 3. In Xcode:
- Seleziona il tuo iPhone come target
- In **Signing & Capabilities** → Team: aggiungi il tuo Apple ID
- Bundle ID: `com.globoup.globoair`
- Assicurati che in **Signing & Capabilities** siano presenti:
  - Background Modes → ✅ Uses Bluetooth LE accessories
  - Background Modes → ✅ Acts as a Bluetooth LE accessory
  - Background Modes → ✅ Audio, AirPlay, and Picture in Picture

### 4. Build & Run
- Premi ▶ con l'iPhone connesso
- Prima esecuzione: su iPhone vai in **Impostazioni → Privacy → Bluetooth** e autorizza GloboAir

---

## Android

### 1. Sincronizza il progetto
```bash
npm run build
npx cap sync android
```

### 2. Apri in Android Studio
```bash
npx cap open android
```

### 3. In Android Studio:
- Attendi il sync Gradle
- Seleziona il tuo Android phone come target
- Build → Run

### 4. Permessi richiesti al primo avvio:
- Microfono ✅
- Bluetooth ✅
- Posizione (necessaria per BLE scan su Android < 12) ✅

---

## Test del broadcast

### Dispositivo A (Broadcaster):
1. Apri GloboAir
2. Tap **"Trasmetti"**
3. Tap sul pulsante verde grande
4. Il telefono inizia a fare advertising BLE

### Dispositivo B (Receiver):
1. Apri GloboAir
2. Tap **"Ascolta"**
3. Tap **"Cerca sessioni"**
4. Dopo pochi secondi compare "GloboAir" nella lista
5. Tap **"Connetti"**
6. Il suono del Dispositivo A arriva in real-time

---

## Troubleshooting

| Problema | Soluzione |
|---|---|
| Sessione non trovata | I due telefoni devono essere a <30m, Bluetooth attivo |
| Audio distorto | Normale nelle prime versioni — codec ADPCM in fase ottimizzazione |
| App crasha su connect | Verifica che entrambi i telefoni abbiano BLE 5.0 |
| "Bluetooth non disponibile" | Emulatori non supportano BLE — serve dispositivo fisico |

---

## Note tecniche PoC v0.1
- Codec: ADPCM IMA 4:1 compression (→ Opus v0.2)
- Sample rate: 8kHz mono
- Frame: 200ms
- Jitter buffer: 3 frame (600ms startup latency)
- BLE MTU: 512 bytes (negoziato)
- Max listeners v0.1: ~20 (GATT connections)
- Max listeners v0.2: illimitati (BLE Extended Advertising)
