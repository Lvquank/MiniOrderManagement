# Mini Order Management — Hệ Thống Quản Lý Đơn Hàng & Kho Hàng

> **Dự án Entry Exam:** Fresher NodeJS Developer  
> **Ứng viên:** **Lê Vinh Quang**  
> **Công nghệ sử dụng:** NestJS 11 · PostgreSQL (Neon Cloud) · TypeORM Migrations · BullMQ · Redis (Upstash) · Swagger UI · Jest

- **GitHub Repository:** https://github.com/Lvquank/MiniOrderManagement
- **Live Demo Dashboard:** https://miniordermanagement.onrender.com/
- **Live Swagger API Docs:** https://miniordermanagement.onrender.com/api/docs

---

## 1. Cách Chạy Local (Local Setup & Run)

### Yêu Cầu Môi Trường
- **Node.js:** Phiên bản `>= 20.0.0`
- **PostgreSQL:** Phiên bản `>= 14`
- **Redis:** Phiên bản `>= 6.2` (khuyên dùng Redis 7 hoặc Upstash Redis)
- Hoặc sử dụng **Docker & Docker Compose** có sẵn trong dự án.

### Các Bước Cài Đặt & Khởi Chạy

1. **Clone mã nguồn từ GitHub:**
   ```bash
   git clone https://github.com/Lvquank/MiniOrderManagement.git
   cd MiniOrderManagement
   ```

2. **Cài đặt các gói phụ thuộc (Dependencies):**
   ```bash
   npm ci
   ```

3. **Cấu hình biến môi trường:**
   Sao chép file `.env.example` thành file `.env`:
   ```bash
   # Trên Linux/macOS:
   cp .env.example .env

   # Trên Windows PowerShell:
   Copy-Item .env.example .env
   ```

4. **Khởi động Database & Redis (Nếu dùng Docker Local):**
   ```bash
   docker compose up -d
   ```
   *(Nếu sử dụng PostgreSQL trên Neon và Redis trên Upstash, bạn chỉ cần điền chuỗi kết nối vào file `.env` mà không cần chạy Docker).*

5. **Chạy Migration để tạo cấu trúc cơ sở dữ liệu:**
   ```bash
   npm run migration:run
   ```

6. **Nạp dữ liệu mẫu (Seeding):**
   Nạp sẵn 12 sản phẩm công nghệ thực tế để thử nghiệm phân trang và đặt hàng:
   ```bash
   npm run seed
   ```

7. **Khởi chạy ứng dụng:**
   - **Chế độ phát triển (Development):**
     ```bash
     npm run start:dev
     ```
   - **Chế độ sản xuất (Production Build):**
     ```bash
     npm run build
     npm run start:prod
     ```
   *(Mặc định khi chạy local, ứng dụng sẽ chạy đồng thời cả HTTP API và Background Worker trong cùng một tiến trình `WORKER_ENABLED=true` để thuận tiện kiểm thử).*

8. **Truy cập hệ thống:**
   - **Web Dashboard:** [http://localhost:3000/](http://localhost:3000/)
   - **Swagger API Docs:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
   - **OpenAPI JSON Spec:** [http://localhost:3000/api/docs-json](http://localhost:3000/api/docs-json)

### Chạy Kiểm Thử (Testing)

```bash
# Chạy toàn bộ 62 Unit Tests bằng Jest
npm test

# Chạy kiểm thử độ bao phủ (Coverage)
npm run test:cov

# Chạy 14 Automated Tests kiểm tra giao diện, bộ lọc, giỏ hàng và phân trang
npm run test:ui

# Chạy kiểm tra kịch bản 10 requests đặt hàng đồng thời chống bán vượt tồn kho
npm run test:concurrency
```

### Bảng Cấu Hình Biến Môi Trường (`.env`)

| Tên biến | Bắt buộc | Giá trị mẫu | Mô tả chi tiết |
|---|---|---|---|
| `PORT` | Không | `3000` | Cổng lắng nghe HTTP server |
| `NODE_ENV` | Không | `development` | Môi trường chạy (`development` / `production`) |
| `DATABASE_URL` | Có | `postgresql://user:pass@host/db` | Chuỗi kết nối PostgreSQL (Neon Pooled connection) |
| `DATABASE_URL_UNPOOLED` | Không | `postgresql://user:pass@host/db` | Chuỗi kết nối trực tiếp cho TypeORM Migration CLI |
| `REDIS_URL` | Tùy chọn | `rediss://default:token@host:port` | Chuỗi kết nối Redis (hỗ trợ cả `redis://` và `rediss://` TLS) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Tùy chọn | `127.0.0.1`, `6379`, `""` | Cấu hình Redis khi không dùng `REDIS_URL` |
| `REDIS_TLS` | Không | `false` (hoặc `true`) | Bật TLS khi kết nối Upstash Redis Cloud |
| `QUEUE_PREFIX` | Không | `bull` | Tiền tố quản lý Redis keys (API và Worker phải giống nhau) |
| `WORKER_ENABLED` | Không | `true` | `true`: Chạy Background Worker; `false`: Chỉ chạy HTTP API |
| `SIMULATE_FAILURE_RATE` | Không | `0.3` | Tỷ lệ lỗi giả lập (30%) để thử thách cơ chế Retry |
| `ORDER_EXPIRY_MINUTES` | Không | `30` | Thời gian hết hạn của đơn hàng PENDING (mặc định 30 phút) |

---

## 2. Mô Tả Bảng Dữ Liệu (Database Schema)

Dự án sử dụng cơ sở dữ liệu quan hệ **PostgreSQL**, quản lý cấu trúc bảng và ràng buộc thông qua **TypeORM Migrations** (`synchronize: false`).

```mermaid
erDiagram
    PRODUCTS ||--o{ ORDER_ITEMS : "được đặt trong"
    ORDERS ||--|{ ORDER_ITEMS : "chứa"
    ORDERS ||--o{ NOTIFICATION_LOGS : "sinh ra"

    PRODUCTS {
        uuid id PK
        varchar sku UK "Mã sản phẩm duy nhất"
        varchar name "Tên sản phẩm"
        numeric price "Đơn giá (>= 0)"
        integer stock "Tồn kho khả dụng (>= 0)"
        timestamp createdAt
        timestamp updatedAt
        timestamp deletedAt "Soft delete"
    }

    ORDERS {
        uuid id PK
        varchar customerName "Tên khách hàng"
        varchar customerEmail "Email khách hàng"
        numeric totalAmount "Tổng tiền đơn hàng (>= 0)"
        varchar status "PENDING | CONFIRMED | CANCELLED | FAILED"
        timestamp createdAt
        timestamp updatedAt
    }

    ORDER_ITEMS {
        uuid id PK
        uuid orderId FK "Tham chiếu orders.id"
        uuid productId FK "Tham chiếu products.id"
        integer quantity "Số lượng mua (> 0)"
        numeric unitPrice "Đơn giá snapshot tại lúc mua (>= 0)"
    }

    NOTIFICATION_LOGS {
        uuid id PK
        uuid orderId "Mã đơn hàng liên quan"
        varchar customerEmail "Email nhận thông báo"
        varchar title "Tiêu đề thông báo"
        text message "Nội dung thông báo"
        varchar status "SENT | FAILED"
        timestamp createdAt
    }
```

### Chi Tiết Các Bảng

1. **Bảng `products` (Quản lý sản phẩm & Tồn kho):**
   - `id`: `UUID` (Primary Key, tạo tự động).
   - `sku`: `VARCHAR(100)`, `UNIQUE NOT NULL` — Mã định danh duy nhất của sản phẩm. Khi xóa mềm (soft delete), SKU vẫn được bảo lưu để đảm bảo tính toàn vẹn lịch sử.
   - `name`: `VARCHAR(255)`, `NOT NULL` — Tên sản phẩm.
   - `price`: `NUMERIC(12, 2)`, `NOT NULL`, có ràng buộc `CHECK (price >= 0)` — Đơn giá sản phẩm.
   - `stock`: `INTEGER`, `NOT NULL`, có ràng buộc `CHECK (stock >= 0)` — Số lượng tồn kho khả dụng.
   - `createdAt`, `updatedAt`: `TIMESTAMPTZ` — Thời điểm tạo và cập nhật.
   - `deletedAt`: `TIMESTAMPTZ`, `NULLABLE` — Đánh dấu xóa mềm, không làm mất dữ liệu lịch sử các đơn hàng cũ.

2. **Bảng `orders` (Quản lý đơn hàng):**
   - `id`: `UUID` (Primary Key).
   - `customerName`: `VARCHAR(255)`, `NOT NULL` — Tên người mua hàng.
   - `customerEmail`: `VARCHAR(255)`, `NOT NULL` — Email nhận thông báo đơn hàng.
   - `totalAmount`: `NUMERIC(12, 2)`, `NOT NULL`, có ràng buộc `CHECK (totalAmount >= 0)` — Tổng giá trị đơn hàng.
   - `status`: `VARCHAR(50)`, `NOT NULL`, mặc định `'PENDING'` — Trạng thái đơn hàng: `PENDING` (Đang xử lý), `CONFIRMED` (Đã xác nhận), `CANCELLED` (Đã hủy), `FAILED` (Thất bại).
   - `createdAt`, `updatedAt`: `TIMESTAMPTZ`.

3. **Bảng `order_items` (Chi tiết các mặt hàng trong đơn):**
   - `id`: `UUID` (Primary Key).
   - `orderId`: `UUID`, `NOT NULL` — Khóa ngoại trỏ đến `orders.id` (`ON DELETE CASCADE`).
   - `productId`: `UUID`, `NOT NULL` — Khóa ngoại trỏ đến `products.id`.
   - `quantity`: `INTEGER`, `NOT NULL`, có ràng buộc `CHECK (quantity > 0)` — Số lượng sản phẩm mua.
   - `unitPrice`: `NUMERIC(12, 2)`, `NOT NULL`, có ràng buộc `CHECK (unitPrice >= 0)` — Đơn giá tại thời điểm đặt hàng. **Đảm bảo nếu sau này giá sản phẩm có thay đổi thì lịch sử tổng tiền đơn hàng cũ vẫn chính xác tuyệt đối**.

4. **Bảng `notification_logs` (Nhật ký thông báo):**
   - `id`: `UUID` (Primary Key).
   - `orderId`: `UUID`, `NOT NULL` — Mã đơn hàng liên quan.
   - `customerEmail`: `VARCHAR(255)`, `NOT NULL` — Email khách hàng nhận thông báo.
   - `title`: `VARCHAR(255)`, `NOT NULL` — Tiêu đề thông báo.
   - `message`: `TEXT`, `NOT NULL` — Nội dung chi tiết thông báo gửi cho khách.
   - `status`: `VARCHAR(50)`, `NOT NULL` (`SENT` / `FAILED`).
   - `createdAt`: `TIMESTAMPTZ`.

---

## 3. Luồng Xử Lý Đơn Hàng & Background Job (Order Lifecycle & Job Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Khách Hàng / Frontend
    participant API as Orders Controller & Service
    participant DB as PostgreSQL Database
    participant Queue as BullMQ (Upstash Redis)
    participant Worker as Background Worker

    Client->>API: POST /orders (customerName, items: [{productId, quantity}])
    Note over API,DB: Bắt đầu Transaction
    API->>DB: Sắp xếp ID và khóa SELECT ... FOR UPDATE (Khóa dòng sản phẩm)
    alt Không đủ tồn kho
        API-->>Client: 400 Bad Request (Hết hàng / Tồn kho không đủ)
        Note over API,DB: Rollback Transaction
    else Đủ tồn kho
        API->>DB: Trừ tồn kho nguyên tử (stock = stock - quantity)
        API->>DB: Tạo bản ghi Order (PENDING) & OrderItems (unitPrice snapshot)
        Note over API,DB: Commit Transaction
        API->>Queue: Đẩy Job process-order (jobId = orderId)
        API-->>Client: 201 Created (Trả thông tin đơn hàng PENDING)
    end

    Note over Queue,Worker: Background Job Processing
    Queue->>Worker: Nhận Job xử lý đơn hàng
    Worker->>Worker: Giả lập độ trễ đóng gói (3-5 giây)
    Worker->>Worker: Kiểm tra lỗi ngẫu nhiên (30% failure rate)

    alt Gặp lỗi mô phỏng & Chưa hết 3 lần thử
        Worker-->>Queue: Ném lỗi để kích hoạt BullMQ Retry
        Note over Queue,Worker: Exponential Backoff (chờ 2s, 4s) rồi thử lại
    else Thành công
        Worker->>DB: Khóa đơn FOR UPDATE -> Chuyển status = CONFIRMED
        Worker->>DB: Ghi log thông báo SENT vào notification_logs
    else Hết 3 lần thử vẫn lỗi (Exhausted)
        Worker->>DB: Khóa đơn FOR UPDATE -> Chuyển status = FAILED
        Worker->>DB: HOÀN TRẢ TỒN KHO cho tất cả sản phẩm trong đơn
        Worker->>DB: Ghi log thông báo FAILED vào notification_logs
    end
```

### Các Giai Đoạn Chi Tiết:

1. **Giai đoạn 1: Tiếp nhận và Trừ kho đồng bộ (HTTP Request)**
   - Client gửi `POST /orders` kèm thông tin khách hàng và danh sách sản phẩm.
   - DTO kiểm tra dữ liệu đầu vào: chuỗi không rỗng, email hợp lệ, số lượng phải là số nguyên dương (`IsInt`, `Min(1)`).
   - Hệ thống mở Database Transaction:
     - Sắp xếp danh sách `productId` tăng dần để tránh Deadlock.
     - Khóa dòng bằng **Pessimistic Locking (`SELECT ... FOR UPDATE`)**.
     - Kiểm tra tồn kho khả dụng của từng sản phẩm. Nếu có bất kỳ mặt hàng nào không đủ kho, transaction rollback toàn bộ và trả về `400 Bad Request`.
     - Trừ tồn kho nguyên tử, lưu `orders` với trạng thái ban đầu là `PENDING`, lưu danh sách `order_items` kèm giá `unitPrice` tại thời điểm mua.
     - Commit transaction thành công.

2. **Giai đoạn 2: Đẩy việc vào hàng đợi bất đồng bộ (Queue Enqueue)**
   - Ngay sau khi transaction commit, API đẩy một job vào hàng đợi `order-processing` với tên job là `process-order`.
   - Thuộc tính `jobId` được đặt bằng chính `order.id` để đảm bảo tính Idempotent (chống enqueue trùng lặp).

3. **Giai đoạn 3: Worker xử lý đơn hàng (`OrderProcessingProcessor`)**
   - Worker nhận job và thực hiện:
     - Mô phỏng độ trễ đóng gói, vận chuyển từ **3 đến 5 giây**.
     - Mô phỏng tỷ lệ lỗi ngẫu nhiên **30%** (`SIMULATE_FAILURE_RATE = 0.3`).
   - **Cơ chế Retry (Tự động thử lại):**
     - Cấu hình tối đa **3 lần thực thi** (`attempts: 3`).
     - Áp dụng thuật toán **Exponential Backoff**: Lần thử 1 lỗi ➔ chờ 2s ➔ thử lần 2 lỗi ➔ chờ 4s ➔ thử lần 3.
   - **Xác nhận thành công (CONFIRMED):**
     - Mở transaction khóa đơn hàng: Cập nhật `status = 'CONFIRMED'`.
     - Tự động tạo bản ghi xác nhận vào bảng `notification_logs` với trạng thái `SENT`.
   - **Xử lý thất bại sau 3 lần thử (FAILED & Hoàn kho):**
     - Nếu sau 3 lần thử đều thất bại, worker chuyển trạng thái đơn hàng thành `FAILED`.
     - **Tự động hoàn trả tồn kho:** Truy vấn toàn bộ sản phẩm trong đơn và cộng hoàn lại đúng số lượng tồn kho tương ứng vào bảng `products`.
     - Ghi nhật ký lỗi vào `notification_logs`.

4. **Giai đoạn 4: Cơ chế Đối soát tự phục hồi (Self-Healing Reconciliation)**
   - Một tiến trình đối soát chạy ngầm mỗi **5 giây**:
     - Quét các đơn hàng `PENDING` trong database nhưng chưa có job hoặc job bị mất trong Redis (do restart hoặc sự cố mạng tạm thời).
     - Tự động tạo lại job đưa vào queue để đảm bảo **không có bất kỳ đơn hàng nào bị bỏ quên**.

5. **Giai đoạn 5: Tự động dọn dẹp đơn hàng quá hạn (Repeatable Cleanup Job)**
   - Thiết lập cron job lặp lại định kỳ mỗi **5 phút** (`*/5 * * * *`).
   - Tự động tìm kiếm các đơn hàng ở trạng thái `PENDING` có tuổi thọ vượt quá **30 phút** (`ORDER_EXPIRY_MINUTES`).
   - Hủy đơn (`CANCELLED`) và hoàn trả toàn bộ số lượng tồn kho về cho sản phẩm.

---

## 4. Cách Chống Bán Vượt Tồn Kho (Concurrency & Overselling Prevention)

Để giải quyết triệt để bài toán **Race Condition** khi hàng chục người cùng bấm mua một sản phẩm có tồn kho bằng 1 (Flash Sale), hệ thống áp dụng chiến lược đa tầng:

```
[Request 1, 2, ..., 10 đồng thời]
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ 1. Transaction & Sắp xếp ID sản phẩm                   │
│    (Tránh Deadlock giữa các đơn hàng nhiều món)        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Khóa dòng Pessimistic Locking (SELECT ... FOR UPDATE)│
│    (Chỉ Request đầu tiên có lock, các request khác chờ) │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Kiểm tra: stock >= quantity?                        │
│    ├── ĐỦ: Trừ tồn kho -> Commit -> Tạo đơn thành công │
│    └── THIẾU: Rollback -> 400 Bad Request (Hết hàng)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. Ràng buộc cứng Database: CHECK (stock >= 0)         │
│    (Bảo vệ toàn vẹn tuyệt đối ở tầng lưu trữ)          │
└────────────────────────────────────────────────────────┘
```

1. **Khóa dòng độc quyền (Pessimistic Locking — `SELECT ... FOR UPDATE`):**
   - Khi tạo đơn, hệ thống đọc dữ liệu sản phẩm kèm cờ `FOR UPDATE` trong transaction của PostgreSQL.
   - Khi 10 requests cùng ập đến, request đầu tiên giữ lock của dòng sản phẩm đó; 9 requests còn lại buộc phải xếp hàng chờ cho đến khi transaction thứ nhất hoàn tất.

2. **Sắp xếp thứ tự ID tránh Deadlock:**
   - Đối với đơn hàng có nhiều sản phẩm, nếu Request A khóa SP 1 rồi SP 2, trong khi Request B khóa SP 2 rồi SP 1 sẽ dẫn đến Deadlock.
   - Hệ thống luôn sắp xếp mảng `productId` tăng dần trước khi thực hiện truy vấn khóa dòng.

3. **Cập nhật tồn kho an toàn & Snapshot giá:**
   - Khi request đầu tiên kiểm tra `stock >= quantity`, tồn kho được trừ ngay trong transaction. Khi commit xong, stock trở về 0.
   - Khi request thứ 2 được cấp lock, nó đọc ra `stock = 0`, điều kiện `stock >= quantity` không thỏa mãn ➔ Trả ngay lỗi `400 Bad Request` ("Sản phẩm đã hết hàng"), transaction rollback an toàn.

4. **Tránh lỗi Lost Update khi Cập nhật sản phẩm (PATCH Product):**
   - API sửa sản phẩm (`PATCH /products/:id`) chỉ thực hiện câu lệnh `UPDATE` trên các trường được gửi lên (như tên hoặc giá), **không bao giờ ghi đè đè trường `stock` từ entity đã đọc cũ**.
   - Nhờ đó, việc đổi tên sản phẩm đồng thời với lúc khách mua hàng không làm biến dạng số lượng tồn kho.

5. **Ràng buộc toàn vẹn ở tầng Cơ sở dữ liệu (Database Invariant):**
   - Bảng `products` có migration thêm ràng buộc:
     ```sql
     ALTER TABLE "products" ADD CONSTRAINT "CHK_products_stock_non_negative" CHECK ("stock" >= 0);
     ```
   - Dù bất kỳ tình huống bất thường nào xảy ra ở tầng ứng dụng, PostgreSQL sẽ lập tức từ chối mọi thao tác ghi khiến tồn kho bị âm.

6. **Kiểm chứng thực nghiệm (Concurrency Verification):**
   - Có sẵn kịch bản kiểm thử: `npm run test:concurrency`.
   - Script tạo 1 sản phẩm có tồn kho bằng 1, sau đó bắn **10 HTTP requests đồng thời** qua `Promise.all`.
   - **Kết quả thực tế:** Luôn đạt chuẩn tuyệt đối: đúng **1 đơn thành công (201 Created)**, **9 đơn báo lỗi hết hàng (400 Bad Request)**, và tồn kho cuối cùng trong Database bằng **0**.

---

## 5. Cách Deploy Worker Riêng Biệt (Background Worker Deployment)

Hệ thống được thiết kế theo kiến trúc tách biệt (**Decoupled Architecture**) giữa Web API và Background Worker:
- **API Service:** Nhận HTTP requests, xác thực, trừ kho, tạo đơn `PENDING` và đẩy job vào hàng đợi.
- **Worker Service:** Độc lập hoàn toàn, không mở cổng HTTP, chỉ kết nối vào Redis để kéo job xử lý, đối soát và chạy cron cleanup.

### Tệp Khởi Chạy Worker Độc Lập
Dự án đã có sẵn file [`src/worker.ts`](file:///d:/LeVinhQuang_Nodejs/src/worker.ts) sử dụng `NestFactory.createApplicationContext`:
- Không mở cổng HTTP (giúp tiết kiệm tài nguyên RAM/CPU tối đa).
- Chỉ khởi tạo module xử lý hàng đợi `OrderProcessingModule`.

### Hướng Dẫn Deploy Trên Các Nền Tảng (Render / Railway / VPS / Docker)

#### Bước 1: Chuẩn bị cơ sở dữ liệu dùng chung
- API và Worker phải kết nối vào **cùng một PostgreSQL Database** (`DATABASE_URL`) và **cùng một Redis Server** (`REDIS_URL` hoặc `REDIS_HOST/PORT/PASSWORD`).
- Biến `QUEUE_PREFIX` ở 2 bên phải đặt giống nhau (mặc định là `bull`).

#### Bước 2: Cấu hình Service cho Background Worker
Tạo một service mới (Background Worker / Worker Service) trên nền tảng hosting của bạn với thông số:

1. **Build Command:**
   ```bash
   npm ci && npm run build
   ```

2. **Start Command (Lệnh khởi chạy Worker):**
   ```bash
   npm run start:worker
   # Hoặc: node dist/src/worker
   ```

3. **Cấu hình các biến môi trường cho Worker:**
   ```env
   NODE_ENV=production
   WORKER_ENABLED=true
   QUEUE_PREFIX=bull
   DATABASE_URL=postgresql://user:password@host/database
   REDIS_URL=rediss://default:token@host:port
   REDIS_TLS=true
   SIMULATE_FAILURE_RATE=0.3
   ORDER_EXPIRY_MINUTES=30
   ```

#### Bước 3: Cấu hình cho HTTP API Service (Nếu tách riêng)
Đối với Web Service phục vụ API:
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm run start:prod` (chạy `node dist/src/main`)
- **Biến môi trường:** Đặt `WORKER_ENABLED=false` để tiến trình API không tốn tài nguyên chạy consumer trùng lặp với worker.

---

## 6. Danh Sách API Endpoints (API Documentation)

Swagger UI tích hợp sẵn tại `/api/docs`. Dưới đây là bảng tổng hợp các endpoint chính:

| Phương thức | Đường dẫn (Endpoint) | Mô tả chức năng | Tham số / Body chính |
|---|---|---|---|
| `GET` | `/products` | Lấy danh sách sản phẩm có phân trang & tìm kiếm | Query: `page`, `limit`, `search`, `minPrice`, `maxPrice` |
| `POST` | `/products` | Tạo sản phẩm mới | Body: `{ sku, name, price, stock }` |
| `GET` | `/products/:id` | Xem thông tin chi tiết một sản phẩm | Param: `id` (UUID) |
| `PATCH` | `/products/:id` | Cập nhật thông tin sản phẩm (giá, tên, kho) | Param: `id`, Body: `{ name?, price?, stock? }` |
| `DELETE` | `/products/:id` | Xóa mềm sản phẩm (Soft delete) | Param: `id` (UUID) |
| `POST` | `/orders` | Tạo đơn hàng mới (Hỗ trợ giỏ hàng nhiều món) | Body: `{ customerName, customerEmail, items: [{ productId, quantity }] }` |
| `GET` | `/orders` | Lấy danh sách đơn hàng có phân trang & lọc | Query: `page`, `limit`, `status` |
| `GET` | `/orders/:id` | Xem chi tiết đơn hàng kèm snapshot đơn giá | Param: `id` (UUID) |
| `PATCH` | `/orders/:id/cancel` | Hủy đơn hàng và tự động hoàn trả tồn kho | Param: `id` (UUID) |
| `GET` | `/orders/:id/jobs` | Tra cứu tiến trình xử lý ngầm của đơn hàng | Param: `id` (trả về số lần thử, lỗi, thời gian) |
| `GET` | `/notifications` | Lấy nhật ký thông báo tự động | Query: `limit` (tối đa 100) |
| `GET` | `/notifications/orders/:orderId` | Xem thông báo của một đơn hàng cụ thể | Param: `orderId` (UUID) |

### Ví Dụ Lệnh cURL Thao Tác Nhanh

**1. Tạo đơn hàng mới:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Lê Vinh Quang",
    "customerEmail": "vinhquang@example.com",
    "items": [
      {
        "productId": "11f9b9cd-fe17-4669-811a-36d4c67026ba",
        "quantity": 1
      }
    ]
  }'
```

**2. Hủy đơn hàng và hoàn kho:**
```bash
curl -X PATCH http://localhost:3000/orders/2976e098-1df6-4182-8d9a-6097971b19cb/cancel
```

---

## 7. Phần Chưa Làm Được & Hướng Phát Triển (Limitations & Future Work)

Theo đúng phạm vi yêu cầu của đề bài kỹ thuật Fresher, hệ thống tập trung sâu vào tính đúng đắn của Transaction, Concurrency Control và Quản lý Background Queue. Dưới đây là các phần chưa thực hiện và hướng nâng cấp cho môi trường Production thực tế:

1. **Chưa tích hợp cổng thanh toán thực tế (Payment Gateway):**
   - Hiện tại, bước thanh toán được giả lập thành công/thất bại thông qua worker. Trong thực tế, cần tích hợp Webhook của các cổng thanh toán (như VNPAY, MoMo, ZaloPay, Stripe) kèm chữ ký số bảo mật (Checksum/HMAC) để xác thực trạng thái thanh toán từ bên thứ ba.

2. **Chưa gửi email qua dịch vụ SMTP/Email Provider thực tế:**
   - Hệ thống hiện tại lưu trữ lịch sử gửi thông báo vào bảng `notification_logs` trong cơ sở dữ liệu để phục vụ kiểm tra và đối soát.
   - Hướng phát triển: Tích hợp dịch vụ gửi email chuyên dụng như SendGrid, AWS SES hoặc Nodemailer qua hàng đợi riêng (`email-queue`).

3. **Chưa có hệ thống Xác thực & Phân quyền (Authentication & Authorization):**
   - Hệ thống chưa có tính năng đăng nhập/đăng ký cho khách hàng hoặc phân quyền Quản trị viên (Admin RBAC với JWT Token / OAuth2).

4. **Kiến trúc phân tán quy mô lớn (High Concurrency & Outbox Pattern):**
   - Cơ chế hiện tại đảm bảo an toàn tuyệt đối với tải vừa và nhỏ. Để mở rộng lên quy mô hàng chục nghìn lượt đặt hàng mỗi giây trên nhiều cụm máy chủ, hệ thống có thể nâng cấp thêm:
     - Áp dụng **Transactional Outbox Pattern** (lưu sự kiện tạo đơn vào bảng outbox trước khi đẩy vào Kafka/RabbitMQ để loại bỏ rủi ro mất kết nối giữa Postgres và Redis).
     - Phân tán Redis Cluster và Read/Write Replica cho PostgreSQL.
