# CAD Floor Nesting

Ứng dụng React để đọc mặt bằng DXF, xếp thảm tấm hoặc thảm cuộn, tính BOQ và hiển thị mảnh thừa có thể tái sử dụng.

## Phiên bản V1

Mốc ổn định `v1.0.0` được lưu bằng Git và bản nén dự phòng `CAD-Floor-Nesting-v1.0.0.zip` trong thư mục dự án. Bản nén chứa mã nguồn và file khóa thư viện; khi cần khôi phục, giải nén sang **một thư mục khác**, chạy `npm ci` rồi `npm run dev -- --host 127.0.0.1`. Không cần sao chép `node_modules` hoặc `dist`.

Để thử nâng cấp sau này, tạo nhánh Git mới từ mốc `v1.0.0` và giữ nguyên mốc V1. Mỗi thay đổi được kiểm tra trước khi đưa vào bản dùng hằng ngày.

## Chạy trên máy

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Mở [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Chạy `npm run build` để kiểm tra bản dựng.

## Kiểm tra thảm cuộn

1. Tải file DXF, chọn layer đường bao phòng, đơn vị và thứ tự thi công.
2. Chọn **Thảm cuộn**, khổ rộng và hướng dải. Bật **Tận dụng Offcut**.
3. Xem mã mảnh nguồn và vị trí dùng lại trên bản vẽ; tab **Mảnh Thừa** cho biết diện tích còn lại.
4. Đối chiếu mét dài cuộn mới khi bật và tắt tận dụng. Phương án tái sử dụng giữa các phòng được kiểm tra để bảo đảm sơ đồ phủ kín sàn, mảnh cắt nằm trong phôi nguồn và lượng cuộn mới giảm.

File [scratch/notched-remnant-case.dxf](scratch/notched-remnant-case.dxf) là trường hợp kiểm tra hai phòng gần với ảnh báo lỗi: mảnh thừa phòng 1 có góc khuyết nhưng phần lớn vẫn cắt được để dùng cho phòng 2. Với thảm cuộn 4 m, dải ngang và phụ cấp cắt 100 mm, ứng dụng giảm từ 41,97 m xuống 37,33 m cuộn mới.

Mảnh thừa được tách thành các hình chữ nhật theo chiều sợi trước khi xét dùng lại. Các phần dưới ngưỡng cạnh ngắn đã cấu hình không được dùng làm phôi. Việc kiểm tra hình học cuối cùng nằm trong `src/services/nestingValidation.ts`.
