# Đánh Giá Đa Phương Thức VLM (Multimodal Vision-Language Evaluation)

> **Vị trí thư mục:** `evaluation/image-experiment/`  
> **Bộ dữ liệu Benchmark:** 600 mẫu tinh hoa (MVSA & Memotion 7k) cân bằng 3 mối quan hệ Ảnh-Chữ  
> **Môi trường Python:** `evaluation/.venv` (hoặc Python 3.8+ cơ bản, không cần cài thêm thư viện phụ thuộc)  

---

## 🎯 Tổng Quan Hệ Thống Đánh Giá

Thư mục này phục vụ toàn bộ quy trình xây dựng, gán nhãn, thẩm định con người (Human-in-the-loop) và đánh giá độ tin cậy liên thẩm định viên (Cohen's Kappa) cho phân hệ Đa phương thức:

1. **Bộ dữ liệu chuẩn:**
   - [`data/vlm_dataset.json`](./data/vlm_dataset.json): Tệp dữ liệu 600 mẫu tinh hoa đã được VLM tiền gán nhãn, liên kết trực tiếp với thư mục hình ảnh chuẩn.
   - [`data/images/`](./data/images/): 600 bức ảnh bài đăng mạng xã hội tương ứng (~37 MB).
   - [`package_assets.py`](./package_assets.py): Script một chạm đóng gói toàn bộ `vlm_dataset.json` và 600 ảnh thành `vlm_benchmark_assets.zip` (37 MB) để upload lên GitHub Releases hoặc Hugging Face.
2. **Giao diện & Quy Chuẩn Thẩm Định Con Người (Human-in-the-Loop Web UI):**
   - [`annotation_guidelines.md`](./annotation_guidelines.md): **Cẩm nang Quy chuẩn Gán nhãn Đa phương thức** (định nghĩa chi tiết 3 mối quan hệ Ảnh-Chữ, 7 nhãn Ekman, cách bóc tách 4 trường và quy tắc xử lý trường hợp biên).
   - [`human_review_ui.html`](./human_review_ui.html): Giao diện web hỗ trợ thẩm định độc lập 4 tiêu chí (Cảm xúc tổng hợp, Quan hệ ảnh-chữ, Cảm xúc text, Cảm xúc ảnh), hỗ trợ phím tắt, so sánh trực quan với VLM và tích hợp sẵn nút tra cứu Quy chuẩn gán nhãn ngay tại chỗ.
   - [`review_server.py`](./review_server.py): Máy chủ HTTP cục bộ nhẹ nhàng phục vụ API nạp danh sách tệp, lưu tức thì bản thẩm định cá nhân (`*_review_<tên>.json`). **Tự động tải & giải nén dữ liệu chuẩn từ GitHub Releases nếu máy người dùng chưa có.**
3. **Pipeline Xây dựng & Minh chứng Dữ liệu:**
   - [`curate_candidate_700_pool.py`](./curate_candidate_700_pool.py): Minh chứng toàn diện thuật toán tuyển chọn và phân tầng 700 mẫu benchmark từ kho MVSA và Memotion 7k.
   - [`retranslate_with_llm.py`](./retranslate_with_llm.py): Dịch tự động chất lượng cao sang tiếng Việt qua Gemini LLM.
   - [`batch_annotate_gemini.py`](./batch_annotate_gemini.py): Gán nhãn sơ bộ số lượng lớn bằng Gemini VLM kèm cơ chế checkpoint và schema validation.
   - [`prepare_multimodal_dataset.py`](./prepare_multimodal_dataset.py): Tính chỉ số độ tin cậy liên thẩm định viên (Cohen's Kappa $\kappa \ge 0.70$) và xuất tập Chuẩn Vàng (Gold Standard).

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh

### 1. Dành cho người đánh giá (Chạy máy chủ thẩm định)
Chỉ cần chạy đúng 1 lệnh, hệ thống sẽ tự động tải dữ liệu nếu chưa có và mở trình duyệt web:
```powershell
python .\evaluation\image-experiment\review_server.py
```
> **Tùy chọn nâng cao:**
> - Đổi URL tải gói dữ liệu: `python review_server.py --download-url <link_direct_download>`
> - Bắt buộc tải lại: `python review_server.py --force-download`
> - Đổi cổng chạy: `python review_server.py --port 8088`

### 2. Dành cho người quản trị (Đóng gói dữ liệu chia sẻ)
Khi có cập nhật mới về ảnh hoặc tệp `vlm_dataset.json`, chạy script để tạo tệp zip:
```powershell
python .\evaluation\image-experiment\package_assets.py
```
Tệp nén tạo ra tại: `evaluation/image-experiment/vlm_benchmark_assets.zip` (~37 MB). Đính kèm tệp này lên GitHub Release với tag tương ứng.

### 3. Tính toán Độ tin cậy Liên thẩm định viên (Cohen's Kappa)
Sau khi 2 thẩm định viên hoàn thành việc gắn nhãn:
```powershell
python .\evaluation\image-experiment\prepare_multimodal_dataset.py --mode compute-kappa
```
