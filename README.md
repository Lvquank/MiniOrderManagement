# Mini Order Management — HEMIDI Entry Exam

Ứng viên: **Lê Vinh Quang** · Fresher NodeJS Developer

NestJS 11 · PostgreSQL · TypeORM migrations · BullMQ · Redis · Swagger · Jest.

Repository: https://github.com/Lvquank/MiniOrderManagement

Demo Render hiện có: https://miniordermanagement.onrender.com/ · [Swagger](https://miniordermanagement.onrender.com/api/docs).
Các thay đổi trong mã nguồn cần được redeploy trước khi có hiệu lực trên demo. Chưa xác nhận một deployment Vercel/Netlify cho bản sửa này; không coi link Render là hoàn thành yêu cầu nền tảng trong đề.

## Chạy local

Yêu cầu Node.js **20 trở lên**, PostgreSQL 14+ và Redis 6.2+; Docker Compose cung cấp PostgreSQL 16 và Redis 7.

```sh
git clone https://github.com/Lvquank/MiniOrderManagement.git
cd MiniOrderManagement
npm ci
cp .env.example .env
docker compose up -d
npm run migration:run
npm run seed
npm run start:dev
```

PowerShell dùng `Copy-Item .env.example .env` thay cho `cp` nếu cần. Không ghi đè `.env` đã cấu hình.

- Dashboard: http://localhost:3000/
- Swagger: http://localhost:3000/api/docs
- OpenAPI JSON: http://localhost:3000/api/docs-json

Production local: `npm run build` rồi `npm run start:prod`. Mặc định tiến trình local chạy API và worker cùng nhau (`WORKER_ENABLED=true`).

## Cấu hình

Xem `.env.example`. Không commit credentials.

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng HTTP, mặc định 3000 |
| `WORKER_ENABLED` | `true`: chạy consumer và đối soát; `false`: chỉ API/producer. Trên Vercel worker luôn tắt |
| `DB_HOST/PORT/USERNAME/PASSWORD/DATABASE` | PostgreSQL local |
| `DATABASE_URL` | URL ứng dụng; dùng pooled URL cho Neon nếu có |
| `DATABASE_URL_UNPOOLED` | URL trực tiếp ưu tiên cho migration CLI |
| `REDIS_URL` | URL `redis://` hoặc `rediss://`, ưu tiên hơn host/port/password |
| `REDIS_HOST/PORT/PASSWORD/TLS` | Cấu hình Redis khi không dùng URL |
| `QUEUE_PREFIX` | API và worker phải giống nhau, mặc định `bull`; dùng prefix riêng cho test |
| `SIMULATE_FAILURE_RATE` | Xác suất lỗi mỗi lần thực thi, mặc định 0.3; dùng 0 hoặc 1 để test xác định |
| `ORDER_EXPIRY_MINUTES` | Hạn PENDING, mặc định 30 phút |

PostgreSQL dùng `synchronize:false`. Sau khi cập nhật code cần chạy migration mới trước khi khởi động. Seed dành cho môi trường demo: chạy lại seed sẽ đặt lại giá/tồn kho sản phẩm mẫu, không dùng như tác vụ production.

## Tổ chức và dữ liệu

```text
src/modules/products/          CRUD, DTO và tồn kho
src/modules/orders/            Đặt/hủy đơn, transaction và hoàn kho
src/modules/order-processing/  Queue, processor và phục hồi công việc
src/modules/notifications/     Nhật ký thông báo
src/database/migrations/       Schema và CHECK constraints
src/main.ts                    HTTP API và dashboard
src/worker.ts                  Worker độc lập, không mở cổng HTTP
public/                        Dashboard HTML/CSS/JS
test/                          Integration test PostgreSQL + Redis
```

| Bảng | Dữ liệu và ràng buộc chính |
|---|---|
| `products` | UUID, SKU unique, name, price numeric(12,2), stock integer, timestamps, deletedAt; price/stock không âm |
| `orders` | Khách hàng, totalAmount numeric(12,2), PENDING/CONFIRMED/CANCELLED/FAILED, timestamps; total không âm |
| `order_items` | FK order/product, quantity > 0, unitPrice >= 0 tại thời điểm mua |
| `notification_logs` | Order ID, email, tiêu đề, nội dung, trạng thái và thời gian |

Không gửi email thật, không có đăng nhập/thanh toán theo scope đề. Tồn kho trong PATCH là **giá trị khả dụng mới tuyệt đối**, không phải số lượng nhập thêm. Các đơn đã giữ hàng vẫn giữ nguyên số lượng của chúng. Sản phẩm đã xóa mềm vẫn giữ SKU để bảo toàn tính duy nhất.

## Luồng đặt hàng và chống ghi đè tồn kho

1. Validate DTO: độ dài chuỗi, số nguyên 32-bit, giá không âm và tối đa 2 chữ số thập phân, UUID/email, danh sách item không rỗng.
2. Sắp xếp product ID, khóa `SELECT ... FOR UPDATE` trong cùng transaction; kiểm tra rồi trừ kho.
3. Lưu đơn PENDING và các item với unitPrice. Tính tổng bằng số đơn vị nhỏ nhất của tiền để hạn chế sai số cộng số thực; từ chối tổng vượt numeric(12,2).
4. Commit rồi thử enqueue job có `jobId=orderId`. Enqueue gặp lỗi được giới hạn thời gian; đơn PENDING đã commit là nguồn đối soát để worker gửi lại.
5. PATCH sản phẩm chỉ UPDATE những cột được gửi lên; đổi tên/giá không lưu lại stock cũ. Soft delete cũng chỉ cập nhật cột xóa mềm.

Khóa đơn được lấy trước khi hủy, xác nhận hoặc hoàn kho. Các luồng hoàn kho cập nhật product theo cùng thứ tự ID. Nếu thao tác bị lỗi giữa chừng, transaction rollback cả trạng thái, kho và notification.

## BullMQ và phục hồi

Queue `order-processing` có hai tên job: `process-order` và `cleanup-stale-orders`.

- Xử lý giả lập 3–5 giây; lỗi ngẫu nhiên mỗi lần khoảng 30% theo cấu hình.
- **3 total attempts = lần đầu + 2 retry**, backoff 2s rồi 4s. Không có lần chờ 8s với cấu hình này.
- Thành công: PENDING → CONFIRMED và 1 notification trong cùng transaction.
- Worker đối soát PENDING mỗi 5 giây và khi khởi động: job thiếu thì enqueue; job đã failed thì thử transaction FAILED + hoàn kho + 1 notification.
- Hoàn kho gặp lỗi DB: đơn còn PENDING và failed job được giữ trong Redis; vòng đối soát tiếp theo hoặc worker mới sẽ thử lại. Không đặt nghiệp vụ hoàn kho trong một event listener chỉ chạy một lần.
- Khóa đơn và điều kiện trạng thái chặn confirm/refund/log lặp. Stable job ID chống enqueue trùng. Không xóa failed jobs khi còn đơn PENDING cần đối soát.
- Repeatable job `*/5 * * * *` hủy PENDING quá 30 phút. Hết hạn và job đang chạy được phân xử qua khóa/trạng thái đơn; đơn đã hủy không bị confirm lại.

Đây là cơ chế đối soát dùng đơn PENDING, không phải distributed transaction Postgres/Redis. Cần ít nhất một worker chạy liên tục. Nếu toàn bộ worker dừng, công việc chờ đến khi worker hoạt động lại. Nếu mất cả dữ liệu Redis và lịch sử failed job, hệ thống có thể enqueue lại PENDING nhưng không khôi phục được số attempts cũ. Chưa có external payment side effect hoặc cam kết exactly-once cho dịch vụ ngoài.

## API

| Endpoint | Chức năng |
|---|---|
| POST/GET `/products` | Tạo/danh sách; page, limit, search theo tên, minPrice, maxPrice |
| GET/PATCH/DELETE `/products/:id` | Chi tiết, cập nhật cột được gửi, xóa mềm |
| POST/GET `/orders` | Đặt đơn/danh sách; page, limit, status |
| GET `/orders/:id` | Item, unitPrice lịch sử và thông tin sản phẩm hiện tại |
| PATCH `/orders/:id/cancel` | Hủy PENDING/CONFIRMED và hoàn kho |
| GET `/orders/:id/jobs` | State, attemptsMade, maxAttempts, failedReason và thời gian |
| GET `/notifications` | Log mới nhất, limit 1–100 |
| GET `/notifications/orders/:orderId` | Log theo đơn |

Ví dụ đặt hàng (thay PRODUCT_UUID bằng ID từ GET products):

```sh
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d '{"customerName":"Nguyen Van A","customerEmail":"a@example.com","items":[{"productId":"PRODUCT_UUID","quantity":1}]}'
curl -X PATCH http://localhost:3000/orders/ORDER_UUID/cancel
```

Lỗi đồng nhất: `{statusCode,message,error,timestamp,path}`. Input không hợp lệ trả 400, không tìm thấy trả 404, SKU trùng trả 409 cả khi tạo đồng thời. Lỗi nội bộ trả thông báo chung; chi tiết chỉ ở server log.

Dashboard escape nội dung người dùng trước khi render; option sản phẩm tạo bằng DOM. Simulator luôn tạo sản phẩm riêng, không reset kho của sản phẩm có sẵn; lỗi request được hiển thị và nút được mở lại.

## Kiểm thử

```sh
npm test -- --runInBand
npm run test:cov -- --runInBand
```

Integration test cần PostgreSQL và Redis thật, dùng schema/prefix tự sinh rồi dọn sau khi chạy. Không chạy migration/xóa dữ liệu trên schema public của ứng dụng.

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mini_order_db TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:integration
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/mini_order_db'
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'
npm run test:integration
```

Các ca quan trọng: 10 request mua stock=1; PATCH đổi tên xen kẽ checkout; rollback nhiều item; lưu giá; cancel đồng thời; SKU trùng đồng thời; 400 cho null/overflow/precision; enqueue lỗi rồi phục hồi; hết 3 attempts, lỗi DB lúc hoàn kho rồi phục hồi sau restart; duplicate job/refund; hủy trước worker; cleanup; migration constraints và Swagger schema.

`npm run test:concurrency` là kiểm tra 10 request song song trên API đang chạy, không phải benchmark tải lớn. Có thể đặt `BASE_URL` để đổi target. Script tạo sản phẩm thử nghiệm riêng. Không suy ra coverage hay độ bền toàn hệ thống chỉ từ số test pass. CI chạy build, unit test và integration test với Postgres/Redis services.

## Deploy API và worker riêng

### API trên Vercel

Vercel hỗ trợ nhận diện NestJS tại `src/main.ts` theo [tài liệu chính thức](https://vercel.com/docs/frameworks/backend/nestjs). `vercel.json` dùng framework `nestjs`, không trỏ vào file dist chưa tồn tại khi upload.

1. Import repository vào tài khoản Vercel, chọn NestJS.
2. Cấu hình DATABASE_URL, DATABASE_URL_UNPOOLED nếu cần, REDIS_URL hoặc Redis host/password/TLS, QUEUE_PREFIX giống worker. Worker tự tắt khi `VERCEL=1`; có thể đặt thêm WORKER_ENABLED=false để làm rõ vai trò.
3. Chạy migration bằng kết nối trực tiếp từ môi trường tin cậy trước deploy. Không chạy migration trong mỗi HTTP request/cold start.
4. Deploy và kiểm tra `/api/docs`, `/products`, tạo đơn và theo dõi `/orders/:id/jobs` cho đến terminal state.
5. Dùng link Vercel đã kiểm chứng làm link API nộp bài. Link Render hiện có không thay thế điều kiện này.

### Worker trên Render/Railway/Fly/VPS

Chạy một service/tiến trình dài hạn với cùng code và cùng Postgres/Redis/prefix:

- Build: `npm ci && npm run build`.
- Start: `npm run start:worker`.
- Environment: `WORKER_ENABLED=true`, không đặt `VERCEL=1`, cùng biến DB/Redis/prefix với API.
- Với Dockerfile hiện tại, dùng start command `node dist/src/worker` cho worker; default command chạy HTTP app.
- Worker dùng application context, không mở cổng HTTP. Nếu dùng Render, chọn loại service hỗ trợ worker dài hạn và tự kiểm tra điều kiện gói dịch vụ trước khi tạo.

Nếu chạy HTTP API riêng trên Render, đặt WORKER_ENABLED=false và start bằng `npm run start:prod`. Local vẫn có thể chạy API + worker cùng tiến trình để demo.

Lý do tách: API trên serverless chỉ xử lý request; consumer, đối soát 5 giây và repeatable cleanup cần tiến trình luôn hoạt động. Tham khảo [BullMQ connections](https://docs.bullmq.io/guide/connections) và [retry](https://docs.bullmq.io/guide/retrying-failing-jobs).

## Giới hạn và phần chưa xác nhận

- Chưa xác nhận deployment Vercel và worker riêng trên tài khoản hosting từ môi trường sửa code này. Cần deploy, chạy migration mới và kiểm tra lại live trước nộp.
- Chưa load-test quy mô lớn, chưa đo p95/p99, chưa chứng minh mọi interleaving hoặc distributed failure.
- Chưa có authentication, payment thật, email thật; đây là scope bài tập. Demo public chỉ dùng dữ liệu giả.
- Giữ completed/failed jobs để hỗ trợ tra cứu và phục hồi; cần retention policy có đối soát nếu vận hành lâu dài.
- Mức lỗi ngẫu nhiên là cấu hình; các test ép 0/1 xác minh nhánh xử lý, không phải phép đo thống kê rằng lỗi production luôn đúng 30%.
