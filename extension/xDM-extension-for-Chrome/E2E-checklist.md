# xDownload Manager extension — manual E2E checklist

Trình duyệt (Chrome MV3 extension) không thể test tự động trong môi trường này (cần
trình duyệt thật + app đang chạy), nên đây là checklist **thủ công** để verify toàn bộ
pipeline: trang web → extension bắt media → POST `/add` → app tải file.

Tham khảo code khi đọc checklist này:
- `extension/manifest.json` — MV3 manifest
- `extension/background.js` — service worker (bắt request, badge, context menu, gửi app)
- `extension/inject.js` — hook `fetch`/XHR/createObjectURL ở MAIN world, bắt HLS ẩn (MSE/blob)
- `extension/relay.js` — cầu nối document_start (isolated) chuyển message inject.js → SW
- `extension/content.js` — overlay "Tải video" (chỉ đọc danh sách đã bắt)
- `extension/lib/detect.js` — logic phân loại media + build AddRequest (đã có unit test)
- `extension/popup.html` / `extension/popup.js` — popup UI
- `Core/Sources/XDownloadManagerKit/Server/DownloadServer.swift` — server `/ping`, `/add`
- `xDownload Manager/Models/AppSettings.swift` — cổng mặc định, thư mục lưu mặc định

---

## 0. Chuẩn bị (Prerequisites)

- [ ] Máy macOS 14+, Xcode có sẵn (project dùng Swift 6.0 / deployment target macOS 14.0).
- [ ] Có mạng khi build lần đầu — pre-build script `scripts/fetch-ffmpeg.sh` sẽ tải
      binary ffmpeg tĩnh (arm64) về `Resources/ffmpeg` nếu chưa có (~49 MB, một lần).
- [ ] Trình duyệt Chrome (hoặc Brave/Edge/Arc/Cốc Cốc — xem mục Cross-browser).

## 1. Build & chạy app

App dùng xcodegen (`project.yml`), `.xcodeproj` đã được commit sẵn nên **không bắt buộc**
phải chạy `xcodegen generate` trừ khi bạn vừa thêm/xoá file source. Scheme tên
`xDownload Manager` (`xDownload Manager.xcodeproj/xcshareddata/xcschemes/xDownload Manager.xcscheme`).

Chọn 1 trong 2 cách:

**A — Xcode (khuyến nghị, xem log/console dễ):**
- [ ] `open ~/xDownload Manager/xDownload Manager.xcodeproj`
- [ ] Chọn scheme "xDownload Manager" → target macOS → nhấn Run (⌘R).
- [ ] Cửa sổ app xDownload Manager hiện ra (danh sách tải trống, chấm tròn xanh/đỏ ở toolbar
      cho biết server đang chạy hay không).

**B — CLI:**
```bash
cd ~/xDownload Manager
xcodebuild -project xDownload Manager.xcodeproj -scheme xDownload Manager -configuration Debug \
  -derivedDataPath /tmp/xdl-dd build
open /tmp/xdl-dd/Build/Products/Debug/xDownload Manager.app
```
- [ ] App mở thành công. Nếu macOS chặn với "Apple could not verify..." (app chưa ký/
      chưa notarize — `CODE_SIGN_ENTITLEMENTS: ""`, `ENABLE_HARDENED_RUNTIME: NO` trong
      `project.yml`), chuột phải vào `.app` → Open, hoặc System Settings → Privacy &
      Security → "Open Anyway".

- [ ] Xác nhận server đang chạy: `curl -s http://127.0.0.1:10008/ping` →
      trả về `{"app":"xDownload Manager","version":"1.0"}` (HTTP 200).
      (Cổng **cố định 10008**, Settings ⌘, → "Cổng server" chỉ hiển thị không sửa được — để
      không bao giờ lệch với cổng hardcode trong `background.js`.)
- [ ] Thư mục lưu mặc định là `~/Downloads` (đổi được ở Settings ⌘, → "Thư mục lưu").
      Ghi nhớ thư mục này để kiểm tra file tải về ở bước sau.

## 2. App-not-running UX (làm TRƯỚC khi load extension nếu muốn test đủ, hoặc quit app tạm thời)

- [ ] Đảm bảo app xDownload Manager **đang KHÔNG chạy** (Cmd+Q hoặc quit từ menu bar icon).
- [ ] Load extension (xem bước 3) rồi mở popup (click icon trên toolbar).
- [ ] Popup hiện pill trạng thái màu đỏ với text **"Chưa mở app"** (do `/ping` fetch thất
      bại → `popup.js: setStatus(false)`).
- [ ] Nếu có item nào trong popup, bấm "Tải" → button chuyển "Đang gửi…" rồi
      **"Lỗi — mở app?"** (do `fetch` tới `/add` reject). Không có lỗi uncaught nào trong
      console của service worker (xem bước Troubleshooting cách mở console SW).
- [ ] Bây giờ mở lại app (bước 1), rồi mở lại popup → pill chuyển xanh **"Đã kết nối"**.

## 3. Load unpacked extension

- [ ] Chrome → `chrome://extensions` → bật "Developer mode" (góc trên phải).
- [ ] "Load unpacked" → chọn thư mục `~/xDownload Manager/extension/`.
- [ ] Extension "xDownload Manager" xuất hiện, không có lỗi đỏ nào trên card (extension đã có
      đủ `manifest.json`, `background.js`, `popup.html`, `lib/detect.js`, `icons/icon16|48|128.png`).
- [ ] Chrome có thể hiện warning permission cho `<all_urls>` (webRequest/cookies) —
      bình thường, extension cần quyền này để bắt media trên mọi trang.

## 4. Direct file (.mp4, kind="file")

- [ ] Mở một trang có link/video `.mp4` trực tiếp. Có thể dùng URL mẫu công khai, ví dụ:
      `https://www.w3schools.com/html/mov_bbb.mp4` hoặc bất kỳ file mp4 nào phục vụ qua
      HTTP với `Content-Type: video/mp4` (hoặc đuôi `.mp4` — cả hai đều được
      `classifyResponse` trong `detect.js` nhận diện).
- [ ] Trong vòng vài giây, badge số trên icon toolbar hiện ≥ 1 (nền màu tím `#4F46E5`).
- [ ] Click icon → popup liệt kê file mp4 với size (KB/MB/GB) và tag **"FILE"**.
- [ ] Click nút "Tải" trên item → text chuyển "Đang gửi…" rồi **"Đã gửi ✓"**.
- [ ] Chuyển qua cửa sổ app xDownload Manager → item mới xuất hiện trong danh sách, trạng thái
      "Đang chờ" → "Đang tải" → "Hoàn tất", tên file lấy từ tên cuối URL.
- [ ] Kiểm tra file thực sự nằm trong thư mục lưu (mặc định `~/Downloads`) sau khi
      "Hoàn tất" — có thể click icon thư mục ở dòng item (mở Finder tại file).

## 5. HLS (.m3u8, kind="hls")

- [ ] Mở một trang phát HLS (network tab của DevTools thấy request `.m3u8`). Có thể dùng
      stream test công khai của Apple, ví dụ:
      `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`
      (dán trực tiếp URL này vào ô "Dán URL để tải…" trong app cũng test được phần
      remux mà không cần qua extension — xem mục Verify POST bên dưới cho cách test độc lập).
- [ ] Badge tăng; popup liệt kê item với tag **"HLS"**.
- [ ] Click "Tải" → app nhận, tải segment, rồi remux bằng ffmpeg đã bundle
      (`FFmpegRemuxer`, `-c copy` stream-copy, không re-encode) thành một file `.mp4` duy
      nhất (tên file = tiêu đề đã sanitize + `.mp4`, xem `DownloadItem.deriveFileName`).
- [ ] Trạng thái item trong app chuyển "Đang tải" → "Hoàn tất"; file `.mp4` xuất hiện
      trong thư mục lưu và phát được bình thường (audio+video đồng bộ).
- [ ] Nếu ffmpeg bundle bị thiếu/hỏng, HLS tải sẽ vào trạng thái "Lỗi" — kiểm tra
      `Resources/ffmpeg` tồn tại và chạy được (`Resources/ffmpeg -version`) nếu gặp lỗi này.

## 6. Context menu

- [ ] Chuột phải vào một link trỏ tới file media trực tiếp (hoặc thẻ `<video>`/`<audio>`/
      `<img>` — manifest khai báo contexts `["link","video","audio","image"]`).
- [ ] Menu context hiện mục **"Tải bằng xDownload Manager"**.
- [ ] Click vào → request được gửi thẳng tới app (không qua popup) — kiểm tra item mới
      xuất hiện trong danh sách app.

## 7. Cookies / Referer (tuỳ chọn, nếu có trang yêu cầu auth)

- [ ] Trên trang cần cookie/referer để tải media, xác nhận app tải không bị lỗi 403
      (cookies + referer + User-Agent được forward qua `sendToApp`/`collectCookies` trong
      `background.js`). So sánh với `curl` thô (không cookie) tới cùng URL — request đó
      nên thất bại/403, còn app tải qua extension thì thành công.

## 8. Verify POST /add (không cần trình duyệt)

Dùng `curl` để test server độc lập với extension, hữu ích khi debug hoặc app chưa có
extension:

```bash
curl -sS -X POST http://127.0.0.1:10008/add \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/v.mp4","kind":"file","title":"Test"}'
```
- [ ] Kết quả mong đợi: `{"ok":true}` (HTTP 200), và item "Test" xuất hiện trong danh
      sách tải của app ngay sau đó.
- [ ] Test lỗi: gửi JSON thiếu field bắt buộc (`url`/`kind`), ví dụ `-d '{}'` →
      mong đợi HTTP 400 `{"ok":false,"error":"bad request"}`.
- [ ] Test ping riêng: `curl -sS http://127.0.0.1:10008/ping` → `{"app":"xDownload Manager","version":"1.0"}`.

## 9. Cross-browser (tuỳ chọn)

- [ ] Lặp lại bước 3 (load unpacked) + một test mp4 + một test HLS trên Brave, Edge,
      Arc, hoặc Cốc Cốc — tất cả đều dùng chung engine Chromium MV3 nên hành vi phải
      giống hệt Chrome.

## 10. Troubleshooting

- **Xem log/lỗi của service worker**: `chrome://extensions` → card "xDownload Manager" →
  click link "service worker" (hoặc "Inspect views: service worker") → mở DevTools
  console. Lưu ý MV3 service worker có thể "ngủ" (idle) — click link đó sẽ đánh thức nó
  và cho thấy log/lỗi runtime.
- **Cổng cố định**: cả app lẫn extension đều dùng **10008** (app: `AppSettings.serverPort` là
  hằng số, UI Settings chỉ hiển thị; extension: hardcode trong `background.js`). Không còn cách
  đổi cổng nên không thể lệch. Nếu popup báo "Chưa mở app" dù app chạy → kiểm tra app có thật
  sự chạy (`curl -s http://127.0.0.1:10008/ping`).
- **Popup không liệt kê media**: popup chỉ có trạng thái kết nối + toggle "Chuyển mọi tải
  xuống". Tải video/HLS qua **nút "Tải video" nổi trên trình phát** (overlay `content.js`),
  không qua popup.
- **App chưa mở firewall prompt**: server bind explicit vào `127.0.0.1` (loopback-only,
  xem comment trong `DownloadServer.start()` giải thích `forceIPv4` + `listenAddressIPv4`
  để tránh bind `0.0.0.0`), nên thường KHÔNG kích hoạt macOS firewall "accept incoming
  connections" — nếu prompt đó vẫn hiện, chọn Allow (an toàn vì chỉ loopback).
- **Gatekeeper chặn app chưa ký**: xem bước 1 (chuột phải → Open, hoặc gỡ quarantine
  bằng `xattr -cr /path/to/xDownload Manager.app`).
- **Extension load lỗi**: kiểm tra đủ file bắt buộc trong `extension/`:
  `manifest.json`, `background.js`, `inject.js`, `relay.js`, `content.js`, `popup.html`,
  `popup.js`, `lib/detect.js`, `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`.
- **`world:"MAIN"` không hỗ trợ**: content script MAIN world cần Chrome/Chromium **111+**
  (mọi Chrome/Brave/Edge/Arc/Cốc Cốc hiện hành đều đạt). Nếu inject.js không chạy, kiểm
  tra phiên bản trình duyệt.

---

## Bắt mọi tải xuống (catch-all downloads)

Kiểm tra tính năng chuyển **mọi** tải xuống của trình duyệt sang app xDownload Manager
(`chrome.downloads.onCreated` trong `background.js`, không chỉ video/media). Toggle
bật/tắt nằm trong popup, lưu ở `chrome.storage.local` key `interceptAllDownloads`
(mặc định BẬT khi chưa set).

- [ ] Load unpacked extension (bước 3) và đảm bảo app xDownload Manager **đang chạy**
      (`curl -s http://127.0.0.1:10008/ping` trả `{"app":"xDownload Manager","version":"1.0"}`).
- [ ] Mở popup → thấy checkbox **"Chuyển mọi tải xuống sang xDownload Manager"** đang **được
      tích** (mặc định bật).
- [ ] Click một link tải trực tiếp KHÔNG phải video — ví dụ `.zip`, `.pdf`, `.mp3`
      (dùng URL công khai bất kỳ). Trình duyệt **KHÔNG** tải file (không có mục nào trên
      thanh tải xuống của Chrome / `chrome://downloads` sạch), thay vào đó item xuất hiện
      trong danh sách app xDownload Manager.
- [ ] Kiểm tra file về đúng **danh mục** app tự phân loại theo đuôi file
      (video/audio/compressed/document/other) và nằm trong **thư mục con danh mục** nếu
      bật setting "Tạo thư mục theo danh mục" trong app.
- [ ] `.m3u8` mở trực tiếp → gửi với `kind="hls"` (app remux); file khác → `kind="file"`.
- [ ] **Tắt toggle** trong popup (bỏ tích) → tải lại cùng link → lần này Chrome tải bình
      thường (item xuất hiện trên thanh tải xuống Chrome, app KHÔNG nhận). Bật lại toggle
      để tiếp tục chuyển hướng.
- [ ] **App đóng (fallback)**: Cmd+Q app xDownload Manager, bật lại toggle, click link tải →
      extension gọi app thất bại nên **fallback**: Chrome tải lại file như bình thường
      (file KHÔNG biến mất). Không có vòng lặp tải vô hạn (guard `passthrough`).
- [ ] Không có lỗi uncaught trong console service worker khi tải (mọi lỗi trong listener
      đã được bọc try/catch).
- **Lưu ý (giới hạn)**: chỉ áp dụng cho link `http:`/`https:`. Tải kiểu `blob:`/`data:`/
      `filesystem:`/`chrome-extension:` (ví dụ file sinh ra bằng JavaScript) KHÔNG chặn
      được — trình duyệt tự tải, đúng thiết kế (không có URL thật để đưa cho app).
- **Any-browser caveat**: đây là extension **Chromium** (Chrome/Brave/Edge/Arc/Cốc Cốc).
      Firefox/Safari cần bản port riêng của chúng.

---

## Overlay nút Tải trên video

Kiểm tra nút "Tải video" nổi (content script `content.js`) hiện đè lên player khi
extension đã bắt được media cho tab đó — không cần mở popup.

- [ ] Load unpacked extension (đảm bảo `content.js` có mặt trong `extension/`), reload
      extension sau khi cập nhật.
- [ ] Mở một trang có `<video>` mà extension bắt được media (site HLS `.m3u8` hoặc
      `.mp4` trực tiếp — xem badge số trên icon extension > 0 để chắc đã bắt được).
- [ ] Xác nhận nút pill tối mờ **"Tải video"** (mũi tên xuống + chữ, KHÔNG emoji) xuất
      hiện ở góc **trên-phải** của khung video.
- [ ] Cuộn/resize trang → nút bám theo đúng vị trí góc trên-phải của player.
- [ ] Click nút:
  - Nếu chỉ có **1 media** → gửi luôn, nút đổi sang trạng thái **"Đã gửi ✓"** (xanh) và
    item xuất hiện trong app (đang tải).
  - Nếu có **nhiều media** → mở panel nhỏ dưới nút, mỗi dòng là 1 media
    (`KIND · tên rút gọn`) với nút "Tải"; click ra ngoài để đóng panel.
- [ ] Click nút KHÔNG kích hoạt play/pause của player (đã stopPropagation).
- [ ] Khi không còn media bắt được (điều hướng sang trang mới sạch) → nút tự biến mất.
- [ ] Gỡ `<video>` khỏi DOM (đổi trang trong SPA) → overlay tương ứng được dọn, không
      để lại nút mồ côi; không tạo nút trùng cho cùng một video.
- **Lưu ý**: nút có thể KHÔNG xuất hiện trên player DRM thật (khoá EME/Widevine) —
  đó là hành vi đúng, vì không có URL playlist nào để tải.

---

## Bắt HLS ẩn (MSE/blob — trang không lộ file .m3u8)

Nhiều trang (vd `stream.example.com`, `sample`…) phát video qua **MSE**: `<video>.src` là
`blob:` (một `MediaSource`), còn playlist `.m3u8` thật được `hls.js` fetch bằng **URL
mờ (UUID, không có đuôi `.m3u8`) + content-type generic** (text/plain,
application/octet-stream, text/html). Bộ phân loại theo header của service worker
KHÔNG thấy → F12 Network "không có file m3u8". `extension/inject.js` (chạy MAIN world,
`document_start`) hook `fetch`/`XMLHttpRequest`, đọc thử vài byte đầu response; nếu
bắt đầu bằng `#EXTM3U` thì đó là playlist HLS → gửi URL thật về SW.

- [ ] Reload extension sau khi cập nhật (`chrome://extensions` → nút reload trên card),
      rồi **refresh trang video** (content/inject script chỉ chèn khi tải trang).
- [ ] Mở một trang MSE/blob (vd embed `https://stream.example.com/embed/…`). Ở F12 → Network
      KHÔNG thấy file `.m3u8`, nhưng thấy `<video>` với `src="blob:…"`.
- [ ] Bấm **play** để player bắt đầu nạp playlist. Trong vài giây: badge số trên icon
      extension ≥ 1, và nút **"Tải video"** nổi hiện trên player.
- [ ] Mở popup → item có tag **"HLS"**, URL là link mờ thật (UUID / `…?token=…`), KHÔNG
      phải `blob:`.
- [ ] Bấm "Tải video" (hoặc "Tải" trong popup) → app nhận `kind="hls"`, tải segment +
      remux ffmpeg ra `.mp4` phát được. Tên file lấy từ tiêu đề tab (`useTabTitle`).
- [ ] Console service worker KHÔNG có lỗi uncaught; console trang KHÔNG vỡ (mọi hook
      bọc try/catch, luôn trả nguyên kết quả gốc cho `fetch`/XHR).
- **blob: playlist đã xử lý (xem mục dưới)**: m3u8 dựng hẳn trong JS + `URL.createObjectURL`
  → extension đọc nội dung blob và gửi thẳng cho app. Chỉ còn ngoài phạm vi: playlist mã hoá
  rồi giải mã trong JS (thân phản hồi không phải `#EXTM3U`), hoặc segment dùng URL **tương đối**
  trong blob playlist (không có base thật — nhưng thực tế blob playlist luôn dùng URL tuyệt đối).
- **Kiểm chứng nhanh không cần app**: mở console của TRANG (không phải SW), chạy
  `fetch("<url_mờ>").then(r=>r.text()).then(t=>console.log(t.slice(0,50)))` — nếu in ra
  `#EXTM3U…` thì hook sẽ bắt được đúng URL đó.

---

## Đổi server (nhiều nguồn phát) — không trộn lẫn

Trang phim thường có nhiều "server", đổi bằng AJAX. Media lưu theo tab; nếu chỉ xoá khi
reload trang top thì đổi server sẽ **gộp** link server cũ + mới. Hai lớp chống lẫn:
1. **Đổi src iframe** (`webRequest.onBeforeRequest` type `sub_frame`) → `clearFrame` xoá media
   của đúng frame điều hướng (mỗi media gắn `frameId`), không đụng frame khác.
2. **Master mới thắng** (xử lý ca AJAX cùng frame — `hls.loadSource()` không điều hướng):
   khi bắt được master mới, `inject.js` bỏ hết payload HLS cũ trong buffer replay, `expandMaster`
   **xoá sạch mọi HLS cũ trong tab** (giữ file thường) rồi thêm variant của server mới. Có guard
   idempotent để replay mỗi 1.5s không churn.

Cơ chế **"video hiện tại thắng"** (SW theo dõi `cur_<tabId>` = master + variants + audio/subtitle
renditions của video đang phát). Khi bắt được một **playlist top-level mới** không thuộc video
hiện tại (master mới, media playlist mới, HOẶC blob mới) → xoá sạch HLS server cũ rồi nhận cái
mới. Áp dụng cho **mọi loại**: master hay media 1 chất lượng, http hay blob, iframe embed hay
jwplayer/videojs/hls.js nhúng thẳng, và đổi **qua lại iframe ↔ nhúng**. Sub-playlist (variant,
audio) của master KHÔNG bị nhầm là video mới nhờ `masterReferencedURLs`. Relay chạy
`document_start` (không replay buffer) nên đổi giữa 2 frame KHÔNG nhấp nháy.

- [ ] Phát server 1, đổi server 2 → dropdown **chỉ** còn server 2 (thử cả server master nhiều
      chất lượng LẪN server blob/media 1 chất lượng).
- [ ] Thử các kiểu: iframe embed, jwplayer/videojs nhúng, blob, và đổi qua lại → luôn đúng
      server hiện tại, không nhấp nháy, không lẫn.
- [ ] Master có audio rendition riêng (`#EXT-X-MEDIA:TYPE=AUDIO`) → khi hls.js tải audio
      playlist, KHÔNG bị nhầm là "video mới" (không xoá nhầm các chất lượng).
- [ ] Master có audio/subtitle rendition riêng: KHÔNG hiện thành row rác (chúng nằm trong
      "nhóm video hiện tại" nên bị bỏ qua, chỉ các chất lượng có nhãn hiện ra).
- **Giới hạn còn lại**: (a) **quảng cáo giữa chừng** (HLS ad xuất hiện SAU khi video chính đã
      phát) sẽ được coi là "video mới" và thay danh sách — đổi lại server để nạp lại nếu gặp;
      pre-roll (ad trước phim) thì OK vì master phim sẽ thắng nó. (b) nhiều video độc lập đồng
      thời trong 1 tab, hoặc playlist fetch trong Web Worker (hook main-thread không thấy). Hiếm
      với trang phim; cách chắc ăn: reload trang.

---

## Master playlist → tách theo chất lượng trong dropdown

Khi playlist bắt được là **master** (`#EXT-X-STREAM-INF`, nhiều chất lượng 480/720/1080),
`inject.js` gửi **nguyên text master** cho SW; SW parse bằng `parseMasterVariants` (có unit
test) và thay bằng **1 entry cho mỗi chất lượng**, tên `"<tiêu đề tab> - 1080p"`. **Ẩn** cả
file master lẫn variant mà hls.js tự load. Media playlist thường (không phải master) giữ
nguyên xử lý cũ (1 item, tên lấy từ URL).

- [ ] Mở trang có master (vd `…/sample-3920-playlist.m3u8` với 480/720/1080).
- [ ] Dropdown/popup hiện **đúng 3 dòng** `Tên phim - 480p / 720p / 1080p` (1080p trên cùng,
      sắp theo bandwidth giảm dần), KHÔNG thấy dòng `…-playlist.m3u8` (master) hay dòng
      `…-1080.m3u8` (variant tự load) riêng lẻ.
- [ ] Bấm 1 chất lượng → app tải đúng variant đó; file `.mp4` = `Tên phim - 1080p.mp4`
      (giữ hậu tố chất lượng để tải nhiều chất lượng không trùng tên).
- [ ] Variant URL tương đối (`sample-3920-1080.m3u8`) resolve đúng theo base URL thật của
      master (vd `…/26ff…/sample-3920-1080.m3u8`) → app fetch được.
- **Giới hạn**: nếu master bị fetch trong Web Worker (không phải main thread) thì hook
      main-world không thấy → rơi về `webRequest`, hiện dòng master (không tách chất lượng),
      nhưng app vẫn tự chọn chất lượng cao nhất khi tải. Hiếm.

---

## Bắt playlist blob: (m3u8 dựng trong JS, không có URL fetch được)

Ca nặng nhất: trang KHÔNG lộ file `.m3u8` ở bất kỳ URL http nào — nó dựng nội dung m3u8
trong JS rồi `URL.createObjectURL(blob)` và đưa `blob:` cho hls.js (thấy được ở F12 là
`<video src="blob:…">` và các request `.ts` rời rạc, nhưng không có m3u8). `inject.js` hook
`URL.createObjectURL`, đọc `blob.text()`; nếu bắt đầu `#EXTM3U` thì gửi **nội dung** m3u8
(không phải URL blob vô dụng) về app qua field mới `playlist` trong `/add`. `HLSDownloader`
parse thẳng nội dung này (bỏ bước fetch playlist), rồi tải segment + remux như thường.

- [ ] Reload extension + refresh trang, bấm play trên trang blob (vd `stream.example.com/embed/…`).
- [ ] Badge ≥ 1, nút "Tải video" hiện; popup có item **HLS** (tên = tiêu đề tab, KHÔNG phải
      chuỗi `blob:…`).
- [ ] Bấm "Tải video" → app nhận, KHÔNG cố fetch URL blob (không lỗi), tải segment theo URL
      **tuyệt đối** trong playlist + remux ffmpeg ra `.mp4` phát được.
- [ ] Nếu segment nằm trên CDN nguỵ trang ảnh (vd `img.example.com`, chèn header giả trước `.ts`)
      thì `TSSync` tự cắt về byte đồng bộ `0x47` — file mp4 vẫn phát được.
- [ ] **Nhiều blob** (quảng cáo + phim): mỗi playlist blob là 1 item trong danh sách; chọn
      đúng cái nội dung chính (thường dài hơn / domain khác cái ad). Ad thường là playlist ngắn
      trỏ `ad-*.img.example.com/obj/ad-site-i18n/…`.
- **Kiểm chứng nhanh nội dung blob** (console TRANG): dán snippet hook `URL.createObjectURL`
  (đọc `obj.text()` in ra khi bắt đầu `#EXTM3U`) rồi reload — thấy toàn bộ m3u8 + biết URL
  segment là tuyệt đối/tương đối.
- **Giới hạn**: segment tương đối trong blob playlist sẽ resolve theo `pageUrl` (thường sai)
  — nhưng blob playlist gần như luôn dùng URL tuyệt đối nên hiếm gặp.

---

## Ghi chú tham chiếu nhanh (cho người review)

- Port mặc định: **10008** (`AppSettings.serverPort`, `ServerController`, `DownloadServer`).
- Thư mục lưu mặc định: **`~/Downloads`** (`AppSettings.downloadDirPath`).
- `/ping` → `{"app":"xDownload Manager","version":"1.0"}`; `/add` thành công →
  `{"ok":true}`; thất bại decode → HTTP 400 `{"ok":false,"error":"bad request"}`.
- Trạng thái item trong app UI: Đang chờ (queued) → Đang tải (running) → Hoàn tất
  (completed) / Lỗi (failed) / Tạm dừng (paused) — `DownloadRowView.statusText`.
- Logic phân loại + build request + sniff HLS ẩn đã có 19 unit test tự động
  (`node --test extension/lib/*.test.js`) — checklist này chỉ cover phần KHÔNG thể test
  tự động (hành vi trình duyệt thật + app thật).
