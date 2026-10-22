# Живой фон Operations UI — локальная проверка 22 октября

[Русский](#русский) | [English](#english)

Более новый результат / Newer result:
[выпуск и живая проверка / release and live verification](2026-10-22-living-sky-release.md).

## Русский

После [выпуска орбитальной панели](2026-10-22-orbital-monitoring-release.md)
пользователь выбрал анимацию фона прямо в интерфейсе. Существующий Млечный Путь
теперь плавно смещается на 4,6% за 28 секунд вместо 1,2% за 150 секунд.
По следующей просьбе пользователя движение всех слоёв фона ускорено вдвое
относительно первого локального варианта; скорости планет сохранены.
Один прозрачный Canvas добавляет три слоя звёзд и ближних частиц с разными
скоростями и мягким мерцанием. Слабая световая вуаль движется отдельно.
Фон остаётся общим для сцены и прозрачной рабочей области.

После замечания о качестве прежний фон 1536×1024 заменён картой Млечного Пути
[NASA SVS / Gaia DR2](https://svs.gsfc.nasa.gov/4851/), без ярких звёзд переднего
плана. Источник 8192×4096; локальные WebP 4096×2048 и 8192×4096 получены
конвертацией линейного RGB в sRGB и уменьшением, без апскейла. Монохромная
обработка, диагональный поворот и приглушённая яркость заданы CSS; чёткие
анимированные звёзды рисуются отдельно. Подбор через srcset учитывает
кадрирование, масштабирование и DPR, в том числе на телефоне. Если выбранный
8K-файл недоступен, компонент пробует 4K и лишь затем оставляет звёздный fallback.
Состав и атрибуция: `ops-ui/public/assets/SKY-CREDITS.md`.

Геометрия планет, орбиты, редкие события и API сохранены. Новых зависимостей,
видео и внешних ресурсов в приложении нет. Canvas перерисовывается не чаще
30 раз в секунду; DPR ограничен 1,5, число частиц на узком экране — 900 вместо
1800. По последней просьбе пользователя количество удвоено с 900 до 1800.
Позиции, яркость, наклон и скорость отдельных звёзд различаются; у небольшой
случайной части есть независимые редкие вспышки длительностью около 0,9 секунды
с плавным нарастанием, ореолом и тонкими лучами. Чёткие ядра и мягкое мерцание
сохранены. Общие скорости слоёв и Млечного Пути сохранены. Пауза, скрытие вкладки, reduced motion и отказ 3D останавливают все новые
слои; активное время сохраняется без перескока при продолжении.

Проверено локально:

- Unit 46/46 и production build прошли. При одновременном запуске нескольких
  программно отрисовываемых WebGL-браузеров прежний тяжёлый тест кадрирования
  превысил timeout; полный последовательный повтор прошёл без изменения теста.
- `node scripts/testLivingSky.cjs`: движение Canvas и текстуры, неизменность
  пикселей и transform на паузе/reduced motion/hidden, продолжение, resize,
  DPR и отсутствие overflow на 1440/390/320 px, отсутствие картинки и 2D-контекста.
  Проверяются исходные 4K/8K размеры, выбор 8K на плотном экране и мониторе UHD,
  переход с недоступного 8K на 4K; сохраняется снимок 3840×2160.
- `node scripts/testOrbitalOperations.cjs`: все девять разделов на
  1440/662/390/320 px, WebGL, управление движением и fallback. Проверка потери
  WebGL-контекста теперь явно выбирает canvas сцены, поскольку canvas фона
  расположен раньше в документе. Покрытие фона проверяется также на
  2560×1080 и 3840×1080 при reduced motion.
- `node scripts/testOrbitalProduction.cjs`: production assets, существующая CSP,
  WebGL, сервисы и вложенное подтверждение прошли.
- Независимая ревизия исходников не нашла подтверждённых дефектов.

Скриншоты и короткое видео находятся локально в
`.superpowers/orbital-operations/living-sky/`. Просмотр с тестовыми данными:
`node scripts/previewOperations.cjs`, `http://127.0.0.1:5188/ops/`.
На момент локальной приёмки изменения ещё не были установлены; последующий
выпуск записан по ссылке выше. Плавность и расход батареи
физического телефона пока не измерены. Декодирование 8K требует около 128 MiB
для RGBA-буфера изображения; фактический расход с GPU-композицией не измерен.

## English

Following the [orbital monitoring release](2026-10-22-orbital-monitoring-release.md),
the user selected background animation implemented directly in the interface.
The existing Milky Way now drifts smoothly by 4.6% over 28 seconds instead of
1.2% over 150 seconds. Following further user feedback, all background layers
move twice as fast as the first local version; planet speeds are unchanged.
One transparent Canvas adds three layers of stars and
nearby particles with different speeds and soft twinkling. A faint light veil
moves separately. The scene and translucent workspace share the same sky.

Following feedback on image quality, the previous 1536×1024 background was
replaced with the [NASA SVS / Gaia DR2](https://svs.gsfc.nasa.gov/4851/) Milky Way
map without bright foreground stars. The source is 8192×4096; local 4096×2048
and 8192×4096 WebP variants are produced by linear RGB to sRGB conversion and
downsampling, without upscaling. CSS applies monochrome treatment, diagonal
rotation and restrained luminance; sharp animated stars are rendered separately.
Srcset selection accounts for cropping, zoom and DPR, including phones. If the
selected 8K file is unavailable, the component tries 4K before leaving a stars-only
fallback. Provenance and attribution: `ops-ui/public/assets/SKY-CREDITS.md`.

Planet geometry, orbits, rare events and APIs are preserved. No dependencies,
videos or external resources were added to the application. Canvas updates are
capped at 30 per second; DPR is capped at 1.5 and narrow screens use 900 particles
instead of 1800. The latest user request doubled the count from 900 to 1800.
Individual stars vary in position, brightness, slope and speed; a small random
subset has independent sparse glints lasting about 0.9 seconds, with a smooth
envelope, halo and thin rays. Sharp cores and gentle twinkling are preserved.
Overall layer and Milky Way speeds are unchanged. Pause, tab visibility, reduced motion and 3D failure stop all new
layers; active time is preserved without a jump on resume.

Verified locally:

- All 46 unit tests and the production build passed. Running several
  software-rendered WebGL browsers concurrently caused the existing expensive
  framing test to time out; a full sequential rerun passed without changing it.
- `node scripts/testLivingSky.cjs`: moving Canvas and texture, unchanged pixels
  and transforms during pause/reduced motion/hidden, resume, resize, DPR and no
  overflow at 1440/390/320 px, missing image and unavailable 2D context.
  The suite checks native 4K/8K dimensions, 8K selection on dense screens and UHD
  monitors, and fallback from unavailable 8K to 4K; it saves a 3840×2160 screenshot.
- `node scripts/testOrbitalOperations.cjs`: all nine sections at
  1440/662/390/320 px, WebGL, motion controls and fallback. The WebGL context-loss
  check now explicitly targets the scene canvas because the sky canvas appears
  earlier in the document. Background coverage is also checked at 2560×1080 and
  3840×1080 with reduced motion.
- `node scripts/testOrbitalProduction.cjs`: production assets, the existing CSP,
  WebGL, services and nested confirmation passed.
- Independent source review found no confirmed defects.

Screenshots and a short video are saved locally under
`.superpowers/orbital-operations/living-sky/`. Preview with synthetic data:
`node scripts/previewOperations.cjs`, `http://127.0.0.1:5188/ops/`.
At local acceptance these changes were not yet installed; the subsequent release
is recorded in the link above. Smoothness and battery
usage on a physical phone have not been measured. Decoding 8K requires about
128 MiB for its RGBA image buffer; actual usage including GPU composition is unmeasured.
