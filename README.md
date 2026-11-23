# vaho
Plataforma interactiva basada en **Tacto** que transforma cualquier teléfono móvil en un **vidrio ciego** conectado por **MQTT** con una experiencia web inmersiva de audio e imagen a pantalla completa.

---

## 1. Concepto
En las mañanas frías o en las noches de lluvia, el vaho se condensa en los cristales de una ventana. Detrás del vidrio descansa una memoria lejana: una bahía al atardecer, casas costeras con ventanas encendidas, el reflejo dorado del sol y el rumor lejano de voces y una caja de música.

El vaho no es un obstáculo: es el umbral de la intimidad. La experiencia no se puede contemplar de forma pasiva ni permanente. Para mirar con nitidez y para escuchar con claridad, es indispensable **tocar**:
- Al deslizar los dedos sobre la superficie, el vaho se disuelve y revela la imagen limpia del recuerdo.
- Al mismo tiempo, el filtro acústico pasa-bajos se abre en tiempo real: **ver es oír**. La nitidez visual coincide con la brillantez sonora.
- Si dejas de tocar, el frío exterior vuelve a condensar el vapor: el vaho regresa paulatinamente en aproximadamente 25 segundos y el tic-tac de un reloj marca el paso del tiempo que borra la memoria.
- Si soplas contra el micrófono, tu propio aliento tibio acelera el regreso de la niebla.
- Las gotas de agua escurren según la inclinación física del teléfono y actúan como **lentes convexas**, mostrando el recuerdo nítido e invertido dentro de cada gota.

---

## 2. Funcionamiento

### Arquitectura de Conexión (MQTT)
El sistema opera mediante el protocolo ligero **MQTT** sobre WebSockets seguros (`wss://`):

```
┌─────────────────────────┐          MQTT / WebSockets          ┌─────────────────────────┐
│     Teléfono Móvil      │ ──────────────────────────────────> │     Experiencia Web     │
│      (index.html)       │ <────────────────────────────────── │       (exp.html)        │
│   Superficie táctil     │         tacto/<sala>/<dev>/...      │   Audio Web + Canvas 2D │
└─────────────────────────┘                                     └─────────────────────────┘
```

1. **Modo Local**: Ejecutado mediante `npm start` (`node server.js`). El servidor Node.js levanta un broker MQTT embebido (**Aedes**) en el puerto 8443 (WebSocket `/mqtt`) y 1883 (TCP), sirviendo certificado HTTPS autofirmado y generando el código QR mediante la ruta `/qr.svg`.
2. **Modo Remoto (GitHub Pages)**: Publicado estáticamente sin necesidad de backend Node.js. Resuelve automáticamente la conexión a un broker público o en la nube (configurado en `config.js` o por parámetro `?broker=wss://...`) y dibuja el código QR en el navegador usando la biblioteca `qrcode-generator`.

### Temas MQTT (`tacto/<sala>/<dispositivo>/...`)

| Tema MQTT | Tipo / QoS | Carga útil (JSON) | Descripción |
|---|---|---|---|
| `tacto/<sala>/<dev>/status` | Retained (QoS 1) | `{"online": bool, "name": str, "caps": {...}}` | Estado de conexión y capacidades detectadas (presión, diámetro, sensores). Incluye *Last Will* si el teléfono se desconecta. |
| `tacto/<sala>/<dev>/touch` | QoS 0 / 1 | `{"t": ms, "n": int, "ar": float, "p": [{"i": 1..5, "x": 0..1, "y": 0..1, "f": 0..1, "d": px}]}` | Puntos de contacto en coordenadas normalizadas, fuerza normalizada `f` y diámetro de contacto `d`. |
| `tacto/<sala>/<dev>/motion`| QoS 0 | `{"t": ms, "a": [alfa, beta, gamma], "r": [rx, ry, rz], "c": [ax, ay, az]}` | Orientación del giroscopio (°), velocidad angular (°/s) y aceleración tridimensional (m/s²). |
| `tacto/<sala>/<dev>/mic`   | QoS 0 | `{"t": ms, "l": 0..1, "b": [graves, medios, agudos]}` | Nivel RMS y tres bandas espectrales del micrófono (con supresión adaptativa de línea base de ruido). |
| `tacto/<sala>/<dev>/cmd`   | QoS 0 | `{"ping": ms}` ó `{"vib": ms}` | Comandos de retorno hacia el teléfono. Mide latencia RTT y activa vibración física (`navigator.vibrate`) al soltarse una gota. |
| `tacto/<sala>/<dev>/pong`  | QoS 0 | `{"t": ms}` | Respuesta inmediata del teléfono para telemetría de latencia. |

---

### Tabla de Gestos y Variables

> **Nota sobre capacidades del teléfono:** El sistema lee los canales de `tacto.js`. Si la pantalla del teléfono reporta la presión como *"constante"* o *"sin dato"*, la experiencia utiliza el diámetro de contacto `t1.d` como sustituto continuo de la presión.

| Gesto / Canal | Imagen (Canvas 2D) | Sonido (Web Audio) |
|---|---|---|
| **Arrastrar 1 dedo** (`t1.x`, `t1.y`) | Despeja un trazo transparente en el vaho. | Chirrido de dedo sobre vidrio; la velocidad controla volumen y tono; `X` controla el paneo estéreo. |
| **Presión** (`t1.f`) o **Diámetro** (`t1.d`) | Ancho y limpieza del trazo; genera gotas si aprieta fuerte. | Brillo del chirrido (frecuencia de corte del filtro pasa-bajos de fricción). |
| **Vaho bajo el dedo** | — | El chirrido suena más "mojado" (`chirrido_b`) sobre niebla densa, y seco (`chirrido_a`) sobre vidrio limpio. |
| **Palma / 3+ dedos / diámetro grande** | Despeja zona amplia y suave con tinte cálido brasa (`#ffa95a`). | Zumbido grave de calor (`calor`) + sonido de barrido suave (`barrido`). |
| **2 dedos: `touch.dist`** | Separar los dedos desenfoca y aleja el recuerdo (zoom out y blur). | Más reverb (`convGain`), filtro más cerrado y caja de música ligeramente más lenta. |
| **Inclinar** (`ang.b`, `ang.g`) | Las gotas escurren hacia donde cae el teléfono:<br>`gx = cos(beta) * sin(gamma)`<br>`gy = sin(beta)`. | Plink acústico de gotas; más grave cuanto mayor es el radio de la gota. |
| **Sacudir** (`acc.x/y/z` desviación vs 9.81 m/s²) | Desprende una lluvia repentina de gotas sobre el vidrio. | Ráfaga de lluvia y resonancia de múltiples gotas. |
| **Soplar** (`mic.level` con línea base adaptativa) | El aliento empaña el vidrio rápidamente de vuelta. | Bucle de soplido de aire tibio (`soplido`). |
| **No tocar** | El vaho regresa solo (~25 s en cubrirse por completo). | Tic-tac de reloj mecánico (`reloj`) cuando queda vidrio despejado y nadie toca. |
| **Claridad mitad izquierda** | — | Despejar el lado izquierdo abre las voces lejanas (`murmullo`). |
| **Claridad mitad derecha** | — | Despejar el lado derecho abre la melodía de la caja de música (`caja_musical`). |
| **Lluvia exterior** | — | Suena fuerte con el vidrio empañado y se desvanece al despejar (el mundo de afuera). |

El teléfono recibe de vuelta una vibración corta (mensaje MQTT `cmd` con `{"vib": 40}`) cuando una gota se desprende o empieza a rodar (en navegadores compatibles con la Web Vibrations API, principalmente Android).

---

### Catálogo de los 12 Sonidos Sintetizados
Todos los sonidos fueron sintetizados mediante el script Python propio [`tools/sintetizar_sonidos.py`](file:///C:/Users/marce/Downloads/tacto-main/tools/sintetizar_sonidos.py) utilizando `numpy` y `scipy`. Están publicados bajo licencia **Creative Commons CC0 1.0 Universal (Dominio Público)** y almacenados en `public/sonidos/` como archivos WAV mono a 44,1 kHz y 16 bits PCM.

Los bucles continuos fueron generados con continuidad de fase espectral y ventanas de fundido cruzado de potencia constante (*equal-power crossfade*) para garantizar bucles sin costuras audibles ni clics:

1. **`chirrido_a.wav`** (4,0 s · Bucle): Fricción por deslizamiento intermitente (*stick-slip*) de un dedo sobre vidrio seco y limpio. Resonancias modales en 1750 Hz y micro-grano de textura.
2. **`chirrido_b.wav`** (4,0 s · Bucle): Fricción sobre vidrio húmedo con condensación. Resonancias más agudas (2550 Hz) con micro-fluctuación acuosa.
3. **`gota_1.wav`** (0,32 s · Disparo): Plink cristalino de gota mediana de agua al desprenderse; caída de frecuencia exponencial de 1550 Hz a 1050 Hz y amortiguamiento acústico.
4. **`gota_2.wav`** (0,42 s · Disparo): Plink de gota gruesa con resonancia subacuática más grave (1100 Hz a 720 Hz).
5. **`gota_3.wav`** (0,25 s · Disparo): Plink muy ágil y agudo de microgota (2100 Hz a 1450 Hz).
6. **`lluvia.wav`** (8,0 s · Bucle): Ruido rosa modelado espectralmente combinado con decenas de impactos aleatorios de microgotas exteriores contra el vidrio.
7. **`calor.wav`** (6,0 s · Bucle): Zumbido sub-grave profundo (65 Hz) con saturación armónica analógica tipo cinta y pulsación orgánica lenta (~0,22 Hz).
8. **`caja_musical.wav`** (8,0 s · Bucle): Melodía original de 8 compases en **La menor** (Am → F → Dm → E7) modelada a partir de los modos de vibración inarmónicos de láminas de acero (modos en $f_0$, $2,76 f_0$ y $5,40 f_0$) y percusión de martillo.
9. **`murmullo.wav`** (8,0 s · Bucle): Coro distante de voces humanas sin palabras en La menor; síntesis formántica con filtros de resonancia vocal en $F_1 \approx 450$ Hz, $F_2 \approx 950$ Hz y $F_3 \approx 2400$ Hz.
10. **`barrido.wav`** (2,0 s · Disparo): Desplazamiento de aire suave y cálido (*whoosh*) con envolvente en arco y barrido de frecuencias bajas-medias.
11. **`reloj.wav`** (4,0 s · Bucle): Mecanismo de escape de reloj de bolsillo antiguo (1 ciclo por segundo: *tick* metálico agudo a los 0,0 s y *tock* amaderado a los 0,5 s).
12. **`soplido.wav`** (4,0 s · Bucle): Exhalación de aliento contra el vidrio frío mediante ruido blanco filtrado en banda (700–1200 Hz) con turbulencia respiratoria.

Para regenerar todos los sonidos en cualquier momento:
```powershell
python tools/sintetizar_sonidos.py
```

---

### Pruebas sin Teléfono (Atajos de Computador)
La experiencia cuenta con controles completos de depuración y prueba sin necesidad de contar con un móvil en mano:
- **Ratón (clic y arrastre):** Emula el dedo deslizándose sobre el vidrio. La velocidad del ratón modula el volumen y tono del chirrido; la posición horizontal `X` modula el paneo estéreo.
- **<kbd>Shift</kbd> + Arrastrar:** Emula el contacto con la palma entera (trazo amplio, sonido de calor y barrido).
- **<kbd>←</kbd> / <kbd>→</kbd> / <kbd>↑</kbd> / <kbd>↓</kbd> (Flechas):** Modifican el vector de gravedad para ver escurrir las gotas en cualquier dirección.
- **Tecla <kbd>S</kbd>:** Sacude el vidrio y desata una lluvia repentina de gotas.
- **Tecla <kbd>B</kbd> (mantener):** Sopla sobre el vidrio (activa el sonido de soplido y acelera el regreso del vaho).
- **Arrastrar y soltar archivo:** Arrastra cualquier imagen JPG o PNG sobre la pantalla para reemplazar el recuerdo.

---

## 3. Reflexión

### Qué descubrí al traducir el tacto a imagen y sonido
Al diseñar VAHO, la principal revelación fue que **el tacto no es un interruptor digital, sino una resistencia física continua**. Tradicionalmente, las interfaces tratan el tacto como un simple evento `click` o una coordenada $(x, y)$. Sin embargo, cuando frotamos un vidrio empañado en la vida real, lo que experimentamos es fricción, velocidad, adherencia (*stick-slip*) y humedad.

Traducir el tacto a sonido demostró que la metáfora poética **"ver es oír"** crea una sinestesia orgánica:
- Un recuerdo visual borroso se percibe de forma natural como un sonido filtrado y distante.
- Al abrir el paso de la luz con la mano, el sonido adquiere frecuencias agudas y presencia espacial inmediata.
- El hallazgo acústico más potente ocurrió con el **vaho bajo el dedo**: frotar un cristal ya limpio produce un chirrido chirriante y seco (`chirrido_a`), mientras que frotar una zona aún densa de niebla produce un roce amortiguado y viscoso (`chirrido_b`). Esa micro-variación hace que la pantalla de vidrio del teléfono deje de sentirse como un pedazo inerte de silicio y cobre la vida de un cristal de ventana empañado.

### Qué queda fuera del teléfono táctil
A pesar de la fidelidad del mapeo multisensorial, existen dimensiones hápticas fundamentales que la tecnología comercial de los teléfonos móviles deja fuera:
1. **La temperatura térmica:** El contraste térmico fundamental del fenómeno (la yema del dedo caliente a 36 °C contra un vidrio enfriado por la noche a 10 °C) es completamente invisible para la pantalla capacitiva. El usuario no siente el frío del cristal ni el calor que su propio cuerpo transfiere a la superficie.
2. **La textura microscópica y la humedad de la piel:** Las pantallas capacitivas están recubiertas de capas oleofóbicas diseñadas para repeler la grasa y el agua, eliminando la rugosidad real de la epidermis y la adherencia física del agua condensada.
3. **La masa y la resistencia al empuje:** El teléfono no ofrece resistencia elástica; no cede ni vibra en función de la presión mecánica real (salvo por actuadores de resonancia lineal limitados).

### Dos mejoras concretas para futuras versiones
1. **Síntesis háptica granular en tiempo real (Continuous Vibration Synthesis):** En lugar de limitar la vibración a pulsos discretos al desprenderse una gota, emplear la *Web Vibrations API* o motores hápticos dedicados para sintetizar en tiempo real micro-ráfagas de vibración acústica sincronizadas con la velocidad del chirrido. Esto crearía la ilusión táctil de fricción y rugosidad directamente bajo la yema del dedo.
2. **Simulación hidrodinámica bidimensional de condensación (Navier-Stokes en GPU):** Implementar en WebGL/WebGPU un campo de difusión de humedad con tensión superficial y capilaridad. Esto permitiría que las gotas no solo caigan verticalmente, sino que absorban micro-gotas vecinas a su paso, se bifurquen según las imperfecciones del vidrio y dejen rastros de vapor con evaporación no uniforme.

---

## 4. Registro de Pruebas con Dispositivo Real

Completa los siguientes campos al conectar tu teléfono físico a la experiencia:

- **Modelo y sistema operativo del teléfono:** `[COMPLETAR: ej. iPhone 15 Pro iOS 17.5 / Samsung Galaxy S23 Android 14]`
- **Calidad de presión detectada (`touch.f`):** `[COMPLETAR: variable / constante / sin dato]`
- **Calidad de diámetro detectada (`touch.d`):** `[COMPLETAR: variable / constante / sin dato · valor aprox. en px]`
- **Máximo de dedos soportados simultáneamente:** `[COMPLETAR: ej. 5 dedos / 10 dedos]`
- **Comportamiento del sensor de giro (`ang.b`, `ang.g`):** `[COMPLETAR: ej. las gotas escurren correctamente hacia abajo y hacia los lados al ladear]`
- **Respuesta a la vibración háptica al soltarse gotas:** `[COMPLETAR: ej. vibra sutilmente en Android / no compatible en iOS Safari]`
- **Latencia promedio observada:** `[COMPLETAR: ej. ~15 ms en red local / ~70 ms en GitHub Pages]`
