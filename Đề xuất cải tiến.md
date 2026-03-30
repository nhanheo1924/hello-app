# **Tài liệu mô tả cải tiến tổng thể cho dự án Hello**

## **1\. Mục tiêu của bản cải tiến**

Mục tiêu của bản cải tiến này là nâng cấp hệ thống từ một ứng dụng quản lí task thiên về sử dụng cá nhân thành một nền tảng cộng tác nhiều người dùng, có quản trị, có kiểm soát quyền truy cập, có cấu hình riêng theo dự án, và đủ sạch để tiếp tục mở rộng trong các giai đoạn sau.

Bản cải tiến không thay đổi triết lí nền hiện tại của hệ thống. Dự án vẫn giữ cấu trúc Web đi qua BFF, sau đó BFF phân tách sang `auth-service` và `task-service`, đồng thời database vẫn chia thành schema `public` cho xác thực và schema `task` cho nghiệp vụ cộng tác. Đây là nền phù hợp để nâng cấp tiếp mà không cần phá bỏ toàn bộ kiến trúc đang có.

Mục tiêu nghiệp vụ mới gồm bốn điểm chính. Thứ nhất là chuẩn hóa hồ sơ người dùng. Thứ hai là chuyển project sang mô hình nhiều người dùng với mời thành viên bằng email và private mặc định. Thứ ba là áp dụng quyền truy cập theo hai tầng để phân biệt quyền hệ thống và quyền trong không gian cộng tác. Thứ tư là bổ sung lớp quản trị gồm settings, activity, audit, notification và admin dashboard.

---

## **2\. Nền hiện tại của hệ thống**

Hiện tại hệ thống đã có các thành phần chính gồm `apps/web`, `apps/bff-service`, `apps/auth-service`, `apps/task-service` và PostgreSQL chạy local bằng Docker. Browser chỉ đi vào BFF, sau đó BFF proxy sang auth hoặc task. Trong database, `auth-service` dùng schema `public`, còn `task-service` dùng schema `task`.

Trong schema `public`, hệ thống đã có các bảng nền cho xác thực như `users`, `sessions`, `refresh_tokens`, `audit_logs`. Bảng `users` hiện đã có `email`, `password_hash`, `status`, `last_login_at`, `full_name`, `google_id` và các trường liên quan đến 2FA.

Trong schema `task`, hệ thống đã có các bảng nền cho cộng tác như `workspaces`, `workspace_members`, `projects`, `project_members`, `columns`, `tasks`, `comments`, `labels`, `task_labels`, `activities`, `idempotency_records`. Các enum hiện tại cũng đã có `workspace_role`, `project_status`, `task_priority`, `task_status`, và bảng `tasks` đã hỗ trợ sắp xếp theo board bằng `column_id` và `order_index`, đồng thời có `due_at` để phục vụ logic theo thời gian.

Điều này có nghĩa là hệ thống không ở trạng thái “làm lại từ số 0”, mà đang có một bộ khung khá đúng hướng. Phần cần làm là **nâng cấp có kiểm soát** để biến các thành phần đang có thành một platform cộng tác trưởng thành hơn.

---

## **3\. Các quyết định kiến trúc đã chốt**

Tớ chốt lại để làm chuẩn cho toàn bộ thiết kế phía dưới nhé.

Quyết định thứ nhất: hệ thống sẽ theo **kiến trúc 4 lớp**.  
Quyết định thứ hai: hệ thống sẽ dùng **role 2 tầng**, nhưng thể hiện ra ngoài theo **6 role sử dụng thực tế**.  
Quyết định thứ ba: **task vẫn là thực thể trung tâm**, chưa tách event riêng; calendar chỉ là một cách nhìn task theo thời gian, còn board là một cách nhìn task theo cột trạng thái.  
Quyết định thứ tư: **notification sẽ là module của task-service**, không tách thành service độc lập ngay bây giờ.  
Quyết định thứ năm: database không cần phá toàn bộ, nhưng cần mở rộng `public.users` và redesign có kiểm soát phần lõi cộng tác trong schema `task`.

---

## **4\. Kiến trúc 4 lớp**

### **4.1. Lớp Identity & Access**

Lớp này chịu trách nhiệm về danh tính và kiểm soát truy cập cấp nền tảng. Nó bao gồm đăng ký, đăng nhập, phiên đăng nhập, refresh token, khóa tài khoản, 2FA, audit bảo mật, và profile người dùng.

Service chịu trách nhiệm chính là `auth-service`.

Lớp này quản lí các câu hỏi như:

* User là ai?  
* User có đăng nhập hợp lệ không?  
* Tài khoản có bị khóa không?  
* User có role hệ thống nào?  
* User có phiên đăng nhập nào đang hoạt động?

### **4.2. Lớp Collaboration**

Lớp này chịu trách nhiệm về cộng tác nghiệp vụ. Nó bao gồm workspace, project, membership, board, cột, task, comment, label, calendar view và mời thành viên.

Service chịu trách nhiệm chính là `task-service`.

Lớp này quản lí các câu hỏi như:

* User thuộc workspace nào?  
* User có đang là thành viên project này không?  
* Task nào thuộc project nào?  
* Board và calendar view đang biểu diễn dữ liệu task ra sao?

### **4.3. Lớp Governance**

Lớp này chịu trách nhiệm về kiểm soát, giám sát và quy tắc vận hành. Nó bao gồm project privacy, project settings, activity log, audit log nghiệp vụ, notification, archive/restore, quản trị thành viên, admin dashboard.

Lớp này trải trên cả `auth-service` và `task-service`, nhưng phần lớn chức năng nghiệp vụ nằm ở `task-service`, vì nguồn sự thật về workspace/project/task đang ở đó. `auth-service` tiếp tục giữ audit bảo mật.

### **4.4. Lớp Experience Layer**

Lớp này là phần frontend và BFF orchestration. Nó chịu trách nhiệm hiển thị UI theo role, ghép dữ liệu từ nhiều endpoint, tối ưu response cho browser, và tổ chức trải nghiệm theo từng loại người dùng.

`bff-service` vẫn giữ vai trò gateway cho browser traffic như hiện tại.

---

## **5\. Mô hình role 2 tầng và 6 role sử dụng thực tế**

Tớ đề xuất role theo hai tầng để tránh nhồi tất cả vào một enum duy nhất.

### **5.1. Tầng hệ thống**

Tầng này nằm trong `users.system_role` ở `auth-service`.

Các giá trị gồm:

* `SUPER_ADMIN`  
* `SYSTEM_ADMIN`  
* `USER`

Ý nghĩa:

* `SUPER_ADMIN` có quyền cao nhất toàn hệ thống  
* `SYSTEM_ADMIN` quản trị vận hành hệ thống  
* `USER` là người dùng thông thường

### **5.2. Tầng cộng tác**

Tầng này nằm trong `workspace_members` và/hoặc `project_members` ở `task-service`.

Các giá trị sử dụng thực tế gồm:

* `WORKSPACE_OWNER`  
* `WORKSPACE_ADMIN`  
* `MEMBER`  
* `VIEWER`

### **5.3. Sáu role vận hành thực tế**

Khi nhìn từ góc độ toàn hệ thống, cậu sẽ làm việc với 6 role sau:

* `SUPER_ADMIN`  
* `SYSTEM_ADMIN`  
* `WORKSPACE_OWNER`  
* `WORKSPACE_ADMIN`  
* `MEMBER`  
* `VIEWER`

Đây không phải là 6 giá trị phải nằm chung trong một cột. Nó là **6 vai trò vận hành thực tế**, được tạo ra từ 2 tầng quyền.

### **5.4. Nguyên tắc áp dụng quyền**

Quyền thật phải nằm ở backend. UI chỉ phản chiếu quyền, không thay thế quyền.

Nói cách khác:

* Backend quyết định user **có được làm không**  
* Frontend quyết định user **có nên nhìn thấy nút đó không**

Đây là nguyên tắc bắt buộc để tránh tình trạng chỉ ẩn nút nhưng vẫn bị gọi API trực tiếp.

---

## **6\. Thiết kế cải tiến theo module**

## **6.1. Identity & Profile 2.0**

### **Mục tiêu**

Chuẩn hóa thông tin cá nhân và biến hồ sơ người dùng thành một thực thể rõ ràng hơn, thay vì chỉ có `full_name`.

### **Thiết kế đề xuất**

Bảng `users` được mở rộng thêm:

* `first_name`  
* `last_name`  
* `dob`  
* `display_name`  
* `avatar_url`  
* `timezone`  
* `locale`  
* `system_role`

Có thể giữ `full_name` thêm một thời gian để tương thích, sau đó dần chuyển toàn bộ logic sang `first_name + last_name`.

### **Giải thích**

* `first_name`, `last_name`, `dob`, `email` là bộ hồ sơ chuẩn  
* `display_name` phục vụ UI  
* `timezone` rất quan trọng vì hệ thống có calendar view  
* `system_role` là nền cho admin hệ thống

### **Màn hình liên quan**

* My Profile  
* Account Security  
* Sessions & Devices  
* Change Password

### **Lưu ý**

Không bao giờ lưu password plain text. Trong DB chỉ có `password_hash`, đúng như mô hình hiện tại.

---

## **6.2. Workspace & Project Collaboration 2.0**

### **Mục tiêu**

Biến project từ một object quản lí task cơ bản thành một không gian cộng tác có quyền, có riêng tư, có cấu hình riêng.

### **Thiết kế đề xuất**

Bảng `projects` được mở rộng thêm:

* `owner_id`  
* `visibility`  
* `default_view`  
* `color`  
* `icon`  
* `start_date`  
* `end_date`  
* `archived_at`  
* `updated_by`

### **Ý nghĩa**

* `owner_id` giúp dự án có chủ sở hữu rõ ràng  
* `visibility` quyết định private hay mở trong workspace  
* `default_view` cho phép dự án mở vào board hoặc calendar  
* `archived_at` chuẩn hóa lifecycle của project

### **Giá trị `visibility`**

* `PRIVATE` — mặc định, chỉ member project truy cập được  
* `WORKSPACE` — member trong workspace có thể xem

Trong MVP, chỉ cần 2 mức này là đủ.

---

## **6.3. Membership và mời thành viên bằng email**

### **Mục tiêu**

Hỗ trợ cộng tác thực sự, không còn kiểu chỉ có creator mới thao tác được.

### **Thiết kế đề xuất**

Giữ `workspace_members` và `project_members`, nhưng mở rộng thêm flow invitation.

Thêm bảng `project_invitations`:

* `id`  
* `project_id`  
* `email`  
* `role`  
* `invited_by`  
* `token`  
* `status`  
* `expires_at`  
* `created_at`

### **Luồng hoạt động**

1. Owner/Admin nhập email người cần mời  
2. Hệ thống tạo invitation token  
3. Nếu email đã có tài khoản, user có thể accept ngay  
4. Nếu chưa có tài khoản, user đăng ký rồi accept  
5. Sau khi accept, hệ thống tạo record trong `project_members`

### **Trạng thái invitation**

* `PENDING`  
* `ACCEPTED`  
* `REVOKED`  
* `EXPIRED`

### **Vai trò của `project_members`**

Bảng `project_members` sẽ là nơi thể hiện membership thật, còn `project_invitations` chỉ là lớp “chờ vào”.

---

## **6.4. Project Settings riêng**

### **Mục tiêu**

Cho phép mỗi project có cấu hình hành vi riêng, thay vì hard-code mọi thứ chung cho toàn hệ thống.

### **Thiết kế đề xuất**

Thêm bảng `project_settings`:

* `project_id`  
* `default_view`  
* `allow_member_invite`  
* `allow_comment`  
* `allow_viewer_comment`  
* `allow_task_reorder`  
* `allow_task_delete_by_member`  
* `task_prefix`  
* `theme_color`  
* `is_private_by_default`  
* `created_at`  
* `updated_at`

### **Chức năng**

Project settings cho phép kiểm soát các chính sách như:

* ai được mời thêm người  
* viewer có được comment không  
* member có được xóa task không  
* mặc định mở ở board hay calendar  
* màu nhận diện dự án  
* quy tắc workflow nhẹ

### **Giao diện đề xuất**

Project Settings nên chia thành 4 nhóm:

* General  
* Members & Access  
* Workflow  
* Visibility

---

## **6.5. Unified Task Engine: Board \+ Calendar**

### **Mục tiêu**

Không tạo event riêng ở giai đoạn này, mà dùng task làm thực thể trung tâm cho cả board view lẫn calendar view.

### **Nền hiện tại**

Hệ thống đã có `columns`, `tasks`, `comments`, `labels`, `activities`, đồng thời task đã có `column_id`, `due_at`, `order_index`, `assignee_id`, `status`, `priority`, nên rất phù hợp để mở rộng thay vì tách domain mới.

### **Thiết kế đề xuất**

Mở rộng bảng `tasks` với:

* `start_at`  
* `due_at`  
* `all_day`  
* `completed_at`  
* `completed_by`  
* `estimated_minutes`  
* `position_version` hoặc giữ `order_index` như hiện tại

### **Cách hiểu**

* Board view dùng `column_id`, `status`, `order_index`  
* Calendar view dùng `start_at`, `due_at`, `all_day`

Nghĩa là:

* một task có thể hiện trên board  
* cùng task đó cũng có thể hiện trên calendar

### **Lợi ích**

* không phân mảnh dữ liệu  
* không phải đồng bộ giữa task và event  
* đơn giản hơn cho MVP  
* vẫn đủ mạnh để mô phỏng lịch làm việc

---

## **6.6. Notification module trong task-service**

### **Mục tiêu**

Thông báo cho đúng người, đúng lúc, dựa trên các sự kiện nghiệp vụ phát sinh từ project/task/comment/invitation.

### **Quyết định kiến trúc**

Notification sẽ là **module nội bộ của `task-service`**, không tách service riêng ngay bây giờ.

### **Lý do**

Nguồn sự thật về project, member, task, comment, activity đang nằm trong `task-service`, và bảng `activities` đã tồn tại sẵn để ghi nhận sự kiện nghiệp vụ. Vì vậy, để notification sinh ra ngay tại nơi nghiệp vụ xảy ra là hướng tự nhiên và ít phức tạp nhất.

### **Thiết kế đề xuất**

Thêm bảng `notifications`:

* `id`  
* `recipient_user_id`  
* `actor_user_id`  
* `workspace_id`  
* `project_id`  
* `task_id`  
* `type`  
* `title`  
* `body`  
* `payload`  
* `is_read`  
* `read_at`  
* `created_at`

### **Luồng hoạt động**

1. User gọi API qua BFF  
2. `task-service` xử lí nghiệp vụ chính  
3. Ghi `activities`  
4. Xác định danh sách recipient  
5. Tạo `notifications` cho từng recipient  
6. Frontend gọi danh sách notification và unread count

### **Loại notification nên có trong MVP**

* task assigned  
* task due soon  
* task overdue  
* comment added  
* project invitation  
* role changed  
* project archived

### **API cơ bản**

* `GET /notifications`  
* `GET /notifications/unread-count`  
* `PATCH /notifications/:id/read`  
* `PATCH /notifications/read-all`

### **Kênh gửi**

Giai đoạn đầu chỉ nên làm:

* in-app notification  
* unread badge  
* optional realtime nhẹ bằng websocket/SSE sau

Chưa cần email queue, push notification, Slack integration ở giai đoạn hiện tại.

---

## **6.7. Activity và Audit**

### **Mục tiêu**

Tăng tính minh bạch, giúp truy vết thao tác và phân biệt rõ log nghiệp vụ với log bảo mật.

### **Nền hiện tại**

Hệ thống đã có `activities` trong schema `task` và `audit_logs` trong schema `public`. Điều này rất thuận lợi để tách hai lớp log.

### **Thiết kế đề xuất**

* `activities`: log nghiệp vụ, ví dụ kéo task, thêm member, archive project  
* `audit_logs`: log bảo mật và xác thực, ví dụ login fail, revoke session, security event

### **Ý nghĩa**

* Activity trả lời câu hỏi: “điều gì đã xảy ra trong project/workspace?”  
* Audit trả lời câu hỏi: “tài khoản hay bảo mật có sự kiện gì?”

### **UI đề xuất**

* Activity Feed theo workspace/project/task  
* Audit Explorer cho admin hệ thống  
* Có filter theo actor, thời gian, entity

---

## **6.8. Admin & Governance**

### **Mục tiêu**

Biến hệ thống từ app quản lí task thành một nền tảng có lớp quản trị thật sự.

### **Phân loại admin**

* `SUPER_ADMIN`  
* `SYSTEM_ADMIN`  
* `WORKSPACE_OWNER`  
* `WORKSPACE_ADMIN`

### **Phạm vi chức năng**

#### **System Admin Dashboard**

Dành cho `SUPER_ADMIN`, `SYSTEM_ADMIN`.

Hiển thị:

* tổng user  
* tổng workspace  
* tổng project  
* tổng task  
* task overdue  
* user bị khóa  
* workspace/project ít hoạt động  
* recent security events

#### **User Management**

Dành cho admin hệ thống.

Cho phép:

* xem user  
* khóa/mở user  
* đổi `system_role`  
* xem session  
* revoke session  
* xem profile cơ bản

#### **Workspace & Project Governance**

Dành cho admin hệ thống và owner/admin trong phạm vi phù hợp.

Cho phép:

* archive project  
* chuyển owner  
* xem member count  
* xem privacy mode  
* kiểm soát settings

#### **Log Explorer**

Cho phép xem:

* activity log  
* audit log  
* timeline thao tác

---

## **6.9. Search, Saved Views và Templates**

### **Mục tiêu**

Tạo cảm giác “sản phẩm trưởng thành”, đồng thời tăng khả năng sử dụng hàng ngày.

### **Search**

Cho phép tìm:

* project  
* task  
* member  
* label

### **Saved Views**

Cho phép lưu các cách nhìn như:

* My Tasks This Week  
* Overdue Tasks  
* Calendar by Assignee  
* High Priority Only

### **Project Templates**

Cho phép tạo project mẫu gồm:

* cột mẫu  
* label mẫu  
* settings mẫu  
* quy ước workflow mẫu

Đây là nhóm tính năng rất nên có sau khi phần nền chính đã ổn.

---

## **7\. Thiết kế cơ sở dữ liệu sau cải tiến**

## **7.1. Hướng tổng quát**

Không cần phá bỏ hoàn toàn database, nhưng cần:

* mở rộng schema `public`  
* redesign có kiểm soát phần lõi cộng tác ở schema `task`

### **Schema `public`**

Giữ:

* `users`  
* `sessions`  
* `refresh_tokens`  
* `audit_logs`

Mở rộng:

* `users.first_name`  
* `users.last_name`  
* `users.dob`  
* `users.display_name`  
* `users.avatar_url`  
* `users.timezone`  
* `users.locale`  
* `users.system_role`

### **Schema `task`**

Giữ:

* `workspaces`  
* `workspace_members`  
* `projects`  
* `project_members`  
* `columns`  
* `tasks`  
* `comments`  
* `labels`  
* `task_labels`  
* `activities`  
* `idempotency_records`

Thêm hoặc mở rộng:

* `projects.owner_id`  
* `projects.visibility`  
* `projects.default_view`  
* `projects.archived_at`  
* `project_invitations`  
* `project_settings`  
* `tasks.start_at`  
* `tasks.all_day`  
* `tasks.completed_at`  
* `tasks.completed_by`  
* `notifications`

---

## **8\. Trách nhiệm của từng service sau cải tiến**

### **`auth-service`**

Chịu trách nhiệm:

* register/login/logout  
* session, refresh token  
* password change  
* 2FA  
* account status  
* system role  
* profile  
* security audit

### **`task-service`**

Chịu trách nhiệm:

* workspace  
* project  
* member  
* invitation  
* settings  
* columns  
* task  
* board view  
* calendar view  
* comments  
* labels  
* activities  
* notifications

### **`bff-service`**

Chịu trách nhiệm:

* route aggregation cho frontend  
* response shaping theo role  
* session-aware gateway  
* tối ưu API cho browser  
* gom dashboard payload nếu cần

---

## **9\. Thiết kế UI theo role**

Không cần làm 6 giao diện hoàn toàn riêng biệt. Cách đúng là dùng **một layout chung**, nhưng hiển thị menu, action và dữ liệu khác nhau theo role.

### **`VIEWER`**

Thấy:

* project overview  
* board  
* calendar  
* task detail read-only

### **`MEMBER`**

Thấy thêm:

* create task  
* edit task trong phạm vi cho phép  
* comment  
* my tasks  
* personal filters

### **`WORKSPACE_ADMIN`**

Thấy thêm:

* members  
* project settings  
* invitation management  
* task moderation

### **`WORKSPACE_OWNER`**

Thấy thêm:

* transfer ownership  
* archive project  
* privacy control  
* access control nâng cao

### **`SYSTEM_ADMIN`**

Thấy thêm:

* users  
* workspaces  
* system dashboard  
* audit explorer

### **`SUPER_ADMIN`**

Thấy toàn bộ, gồm cả các thao tác cấp nền tảng nhạy cảm.

---

## **10\. Lộ trình triển khai đề xuất**

## **Phase 1 – Foundation**

* mở rộng `users`  
* thêm `system_role`  
* thêm `projects.visibility`  
* thêm `projects.owner_id`  
* thêm `project_settings`  
* thêm `project_invitations`

## **Phase 2 – Collaboration**

* flow mời bằng email  
* accept invitation  
* role-based UI  
* private mặc định  
* task calendar upgrade  
* project settings screen

## **Phase 3 – Governance**

* admin dashboard  
* notifications module  
* activity explorer  
* audit explorer  
* archive/restore flow

## **Phase 4 – Product Maturity**

* saved views  
* search nâng cao  
* project templates  
* realtime notification nhẹ  
* reporting sâu hơn

---

## **11\. Kết luận thiết kế**

Nếu nhìn dưới góc độ kĩ sư thiết kế hệ thống, thì bản cải tiến này không phải là “chắp thêm vài tính năng”, mà là **nâng hệ thống từ task manager cá nhân lên collaboration platform có quản trị**.

Điểm mạnh là cậu không cần phá bỏ nền hiện tại. Hệ thống đang có sẵn BFF, auth-service, task-service, phân tách schema `public` và `task`, đồng thời đã có các bảng rất quan trọng như `workspace_members`, `project_members`, `tasks`, `comments`, `activities`, `audit_logs`. Điều cậu cần bây giờ là mở rộng đúng chỗ để toàn bộ hệ thống trở nên đồng bộ hơn và có khả năng phát triển lâu dài.

Chốt lại, bản cải tiến đã được thống nhất sẽ có các trụ cột sau:

* kiến trúc 4 lớp  
* role 2 tầng với 6 role sử dụng thực tế  
* profile người dùng chuẩn hóa  
* project nhiều người dùng, private mặc định  
* mời thành viên bằng email  
* project settings riêng  
* task là trung tâm cho board và calendar  
* notification là module trong task-service  
* activity và audit tách bạch  
* admin dashboard và governance layer

Bản này đủ mạnh để gọi là **một cải tiến lớn** cho dự án, nhưng vẫn đủ thực tế để cậu triển khai từng phase mà không bị quá tải 😌

Ở bước tiếp theo, hợp lí nhất là tớ chuyển bản mô tả này thành **bản đặc tả database \+ ERD \+ schema Prisma đề xuất** để cậu bắt đầu sửa hệ thống thật.

Database

Được, tớ sẽ triển khai theo đúng thứ mình đã chốt: giữ mô hình Web → BFF → `auth-service` / `task-service`, giữ tách schema `public` và `task`, và thiết kế mới theo hướng **mở rộng có kiểm soát** chứ không đập toàn bộ. Hiện tại hệ thống của cậu đã có sẵn BFF, `auth-service`, `task-service`, cùng các bảng nền như `users`, `sessions`, `workspaces`, `workspace_members`, `projects`, `project_members`, `columns`, `tasks`, `comments`, `labels`, `activities`, nên hướng đúng là nâng cấp tiếp trên bộ khung đó.

Một điểm rất quan trọng trước khi vào schema: vì hiện tại `auth-service` quản lí schema `public`, còn `task-service` quản lí schema `task`, nên ở bản thiết kế dưới đây tớ **không ép cross-schema foreign key từ task sang users** trong Prisma của `task-service`. Thay vào đó, các trường như `ownerUserId`, `createdByUserId`, `assigneeUserId` sẽ là **logical reference** tới `public.users.id`, được kiểm soát ở service layer. Cách này khớp với boundary hiện tại của cậu và tránh coupling quá chặt giữa hai service. Đây là suy luận thiết kế dựa trên topology hiện tại của repo.

---

# **1\. Đặc tả database tổng thể**

## **1.1. Mục tiêu thiết kế mới**

Bản database mới phải giải quyết được 7 việc:

* Chuẩn hóa profile người dùng.  
* Tách rõ quyền hệ thống và quyền cộng tác.  
* Hỗ trợ workspace và project nhiều người dùng.  
* Project private mặc định và có setting riêng.  
* Task là thực thể trung tâm cho cả board view lẫn calendar view.  
* Notification là module nội bộ của `task-service`.  
* Vẫn tương thích với kiến trúc hiện tại.

## **1.2. Phân chia schema**

### **Schema `public` – thuộc `auth-service`**

Chứa:

* người dùng  
* session  
* refresh token  
* audit bảo mật

Hiện tại schema này đã có `users`, `sessions`, `refresh_tokens`, `audit_logs`; bản mới sẽ mở rộng thêm trường profile và `system_role`.

### **Schema `task` – thuộc `task-service`**

Chứa:

* workspace  
* project  
* membership  
* project settings  
* project invitations  
* board columns  
* tasks  
* comments  
* labels  
* activities  
* notifications  
* idempotency

Hiện tại schema này đã có sẵn `workspaces`, `workspace_members`, `projects`, `project_members`, `columns`, `tasks`, `comments`, `labels`, `task_labels`, `activities`, `idempotency_records`; bản mới sẽ mở rộng thêm privacy, settings, invitation, notification và các field lịch cho task.

---

# **2\. Role model được hiện thực trong DB**

## **2.1. Tầng hệ thống**

Lưu trong `public.users.systemRole`.

Giá trị:

* `SUPER_ADMIN`  
* `SYSTEM_ADMIN`  
* `USER`

## **2.2. Tầng cộng tác**

Lưu trong `task.workspace_members.role` và `task.project_members.role`.

Giá trị:

* `OWNER`  
* `ADMIN`  
* `MEMBER`  
* `VIEWER`

## **2.3. Mapping ra 6 role vận hành thực tế**

Ở mức nghiệp vụ/UI, hệ thống sẽ coi đây là 6 vai trò:

* `SUPER_ADMIN`  
* `SYSTEM_ADMIN`  
* `WORKSPACE_OWNER`  
* `WORKSPACE_ADMIN`  
* `MEMBER`  
* `VIEWER`

Tức là:

* `systemRole = SUPER_ADMIN` → `SUPER_ADMIN`  
* `systemRole = SYSTEM_ADMIN` → `SYSTEM_ADMIN`  
* `workspace_members.role = OWNER` → `WORKSPACE_OWNER`  
* `workspace_members.role = ADMIN` → `WORKSPACE_ADMIN`

---

# **3\. Đặc tả bảng dữ liệu**

## **3.1. Schema `public`**

### **`users`**

Mục đích: hồ sơ người dùng \+ quyền hệ thống \+ trạng thái tài khoản.

Các cột chính:

* `id`  
* `email`  
* `password_hash`  
* `status`  
* `system_role`  
* `first_name`  
* `last_name`  
* `display_name`  
* `full_name` (giữ tạm để migrate mềm)  
* `dob`  
* `avatar_url`  
* `timezone`  
* `locale`  
* `email_verified_at`  
* `last_login_at`  
* `google_id`  
* `two_factor_enabled`  
* `two_factor_secret`  
* `two_factor_temp_secret`  
* `two_factor_backup_codes`  
* `created_at`  
* `updated_at`

Ràng buộc:

* unique `email`  
* unique `google_id` nếu có  
* index `(status, system_role)`

### **`sessions`**

Mục đích: phiên đăng nhập thiết bị.

Giữ gần như hiện tại:

* `id`  
* `user_id`  
* `ip`  
* `user_agent`  
* `device_id`  
* `created_at`  
* `last_seen_at`  
* `revoked_at`  
* `revoke_reason`

### **`refresh_tokens`**

Mục đích: refresh token rotation.

Giữ gần như hiện tại:

* `id`  
* `session_id`  
* `token_hash`  
* `created_at`  
* `expires_at`  
* `revoked_at`  
* `replaced_by_token_id`  
* `created_by_ip`  
* `created_by_user_agent`  
* `last_used_at`  
* `updated_at`

### **`audit_logs`**

Mục đích: audit bảo mật và auth.

Giữ hiện tại, có thể mở rộng:

* `id`  
* `user_id`  
* `email`  
* `ip`  
* `user_agent`  
* `action`  
* `detail`  
* `created_at`

---

## **3.2. Schema `task`**

### **`workspaces`**

Mục đích: không gian cộng tác cấp cao nhất.

Các cột:

* `id`  
* `name`  
* `slug`  
* `description`  
* `owner_user_id` (logical ref tới `public.users.id`)  
* `status`  
* `created_at`  
* `updated_at`

### **`workspace_members`**

Mục đích: user nào thuộc workspace nào và vai trò gì.

Các cột:

* `workspace_id`  
* `user_id`  
* `role`  
* `joined_at`  
* `invited_by_user_id`  
* `status`

Khóa chính:

* composite `(workspace_id, user_id)`

### **`projects`**

Mục đích: đơn vị cộng tác chính trong workspace.

Các cột:

* `id`  
* `workspace_id`  
* `owner_user_id`  
* `name`  
* `slug`  
* `description`  
* `status`  
* `visibility`  
* `default_view`  
* `color`  
* `icon`  
* `start_date`  
* `end_date`  
* `created_by_user_id`  
* `updated_by_user_id`  
* `archived_at`  
* `created_at`  
* `updated_at`

Lưu ý:

* `visibility` mặc định là `PRIVATE`  
* `default_view` là `BOARD` hoặc `CALENDAR`

### **`project_members`**

Mục đích: thành viên thực tế của project.

Các cột:

* `project_id`  
* `user_id`  
* `role`  
* `joined_at`  
* `invited_by_user_id`  
* `status`

Khóa chính:

* composite `(project_id, user_id)`

### **`project_invitations`**

Mục đích: luồng mời vào project bằng email.

Các cột:

* `id`  
* `project_id`  
* `email`  
* `role`  
* `invited_by_user_id`  
* `token`  
* `status`  
* `expires_at`  
* `accepted_at`  
* `created_at`  
* `updated_at`

### **`project_settings`**

Mục đích: cấu hình riêng từng project.

Các cột:

* `project_id`  
* `default_view`  
* `allow_member_invite`  
* `allow_comment`  
* `allow_viewer_comment`  
* `allow_task_reorder`  
* `allow_task_delete_by_member`  
* `task_prefix`  
* `theme_color`  
* `is_private_by_default`  
* `created_at`  
* `updated_at`

Quan hệ:

* one-to-one với `projects`

### **`columns`**

Mục đích: cột board kiểu Trello.

Các cột:

* `id`  
* `project_id`  
* `name`  
* `position`  
* `created_at`  
* `updated_at`

### **`tasks`**

Mục đích: thực thể trung tâm cho cả board view và calendar view.

Hiện tại bảng `tasks` đã có `project_id`, `column_id`, `priority`, `status`, `due_at`, `assignee_id`, `order_index`, `created_by`, `archived_at`, nên bản thiết kế mới chỉ mở rộng chứ không thay đổi bản chất.

Các cột mới và cũ nên có:

* `id`  
* `project_id`  
* `column_id`  
* `title`  
* `description`  
* `priority`  
* `status`  
* `start_at`  
* `due_at`  
* `all_day`  
* `estimated_minutes`  
* `completed_at`  
* `completed_by_user_id`  
* `assignee_user_id`  
* `order_index`  
* `created_by_user_id`  
* `archived_at`  
* `created_at`  
* `updated_at`

Ý nghĩa:

* board view đọc `column_id`, `status`, `order_index`  
* calendar view đọc `start_at`, `due_at`, `all_day`

### **`comments`**

Mục đích: comment trong task.

Các cột:

* `id`  
* `task_id`  
* `author_user_id`  
* `content`  
* `created_at`  
* `updated_at`

### **`labels`**

Mục đích: nhãn theo workspace.

Các cột:

* `id`  
* `workspace_id`  
* `name`  
* `color`  
* `created_at`  
* `updated_at`

Unique:

* `(workspace_id, name)`

### **`task_labels`**

Mục đích: many-to-many giữa task và label.

Các cột:

* `task_id`  
* `label_id`  
* `created_at`

Khóa chính:

* composite `(task_id, label_id)`

### **`activities`**

Mục đích: log nghiệp vụ của collaboration layer.

Hiện tại đã có bảng này; tớ giữ và chuẩn hóa thêm enum/type nếu cần.

Các cột:

* `id`  
* `workspace_id`  
* `project_id`  
* `task_id`  
* `actor_user_id`  
* `action`  
* `entity_type`  
* `entity_id`  
* `payload`  
* `created_at`

### **`notifications`**

Mục đích: notification in-app, nằm trong `task-service`.

Các cột:

* `id`  
* `recipient_user_id`  
* `actor_user_id`  
* `workspace_id`  
* `project_id`  
* `task_id`  
* `type`  
* `title`  
* `body`  
* `payload`  
* `is_read`  
* `read_at`  
* `created_at`

### **`idempotency_records`**

Mục đích: chống request trùng cho các thao tác ghi dữ liệu.

Giữ gần như hiện tại:

* `id`  
* `key`  
* `user_id`  
* `action`  
* `request_hash`  
* `response`  
* `created_at`

---

# **4\. ERD logic**

Tớ viết theo Mermaid để cậu có thể copy vào markdown, docs hoặc render online.

erDiagram  
    USERS {  
        uuid id PK  
        string email UK  
        string password\_hash  
        string status  
        string system\_role  
        string first\_name  
        string last\_name  
        string display\_name  
        string full\_name  
        datetime dob  
        string avatar\_url  
        string timezone  
        string locale  
        datetime email\_verified\_at  
        datetime last\_login\_at  
        string google\_id UK  
        boolean two\_factor\_enabled  
        datetime created\_at  
        datetime updated\_at  
    }

    SESSIONS {  
        uuid id PK  
        uuid user\_id FK  
        string ip  
        string user\_agent  
        string device\_id  
        datetime created\_at  
        datetime last\_seen\_at  
        datetime revoked\_at  
        string revoke\_reason  
    }

    REFRESH\_TOKENS {  
        uuid id PK  
        uuid session\_id FK  
        string token\_hash  
        datetime created\_at  
        datetime expires\_at  
        datetime revoked\_at  
        uuid replaced\_by\_token\_id  
        string created\_by\_ip  
        string created\_by\_user\_agent  
        datetime last\_used\_at  
        datetime updated\_at  
    }

    AUDIT\_LOGS {  
        uuid id PK  
        uuid user\_id  
        string email  
        string ip  
        string user\_agent  
        string action  
        json detail  
        datetime created\_at  
    }

    WORKSPACES {  
        uuid id PK  
        string name  
        string slug UK  
        string description  
        uuid owner\_user\_id  
        string status  
        datetime created\_at  
        datetime updated\_at  
    }

    WORKSPACE\_MEMBERS {  
        uuid workspace\_id PK  
        uuid user\_id PK  
        string role  
        string status  
        uuid invited\_by\_user\_id  
        datetime joined\_at  
    }

    PROJECTS {  
        uuid id PK  
        uuid workspace\_id FK  
        uuid owner\_user\_id  
        string name  
        string slug  
        string description  
        string status  
        string visibility  
        string default\_view  
        string color  
        string icon  
        date start\_date  
        date end\_date  
        uuid created\_by\_user\_id  
        uuid updated\_by\_user\_id  
        datetime archived\_at  
        datetime created\_at  
        datetime updated\_at  
    }

    PROJECT\_MEMBERS {  
        uuid project\_id PK  
        uuid user\_id PK  
        string role  
        string status  
        uuid invited\_by\_user\_id  
        datetime joined\_at  
    }

    PROJECT\_INVITATIONS {  
        uuid id PK  
        uuid project\_id FK  
        string email  
        string role  
        uuid invited\_by\_user\_id  
        string token UK  
        string status  
        datetime expires\_at  
        datetime accepted\_at  
        datetime created\_at  
        datetime updated\_at  
    }

    PROJECT\_SETTINGS {  
        uuid project\_id PK,FK  
        string default\_view  
        boolean allow\_member\_invite  
        boolean allow\_comment  
        boolean allow\_viewer\_comment  
        boolean allow\_task\_reorder  
        boolean allow\_task\_delete\_by\_member  
        string task\_prefix  
        string theme\_color  
        boolean is\_private\_by\_default  
        datetime created\_at  
        datetime updated\_at  
    }

    COLUMNS {  
        uuid id PK  
        uuid project\_id FK  
        string name  
        int position  
        datetime created\_at  
        datetime updated\_at  
    }

    TASKS {  
        uuid id PK  
        uuid project\_id FK  
        uuid column\_id FK  
        string title  
        string description  
        string priority  
        string status  
        datetime start\_at  
        datetime due\_at  
        boolean all\_day  
        int estimated\_minutes  
        datetime completed\_at  
        uuid completed\_by\_user\_id  
        uuid assignee\_user\_id  
        decimal order\_index  
        uuid created\_by\_user\_id  
        datetime archived\_at  
        datetime created\_at  
        datetime updated\_at  
    }

    COMMENTS {  
        uuid id PK  
        uuid task\_id FK  
        uuid author\_user\_id  
        string content  
        datetime created\_at  
        datetime updated\_at  
    }

    LABELS {  
        uuid id PK  
        uuid workspace\_id FK  
        string name  
        string color  
        datetime created\_at  
        datetime updated\_at  
    }

    TASK\_LABELS {  
        uuid task\_id PK,FK  
        uuid label\_id PK,FK  
        datetime created\_at  
    }

    ACTIVITIES {  
        uuid id PK  
        uuid workspace\_id FK  
        uuid project\_id FK  
        uuid task\_id FK  
        uuid actor\_user\_id  
        string action  
        string entity\_type  
        string entity\_id  
        json payload  
        datetime created\_at  
    }

    NOTIFICATIONS {  
        uuid id PK  
        uuid recipient\_user\_id  
        uuid actor\_user\_id  
        uuid workspace\_id FK  
        uuid project\_id FK  
        uuid task\_id FK  
        string type  
        string title  
        string body  
        json payload  
        boolean is\_read  
        datetime read\_at  
        datetime created\_at  
    }

    IDEMPOTENCY\_RECORDS {  
        uuid id PK  
        string key  
        uuid user\_id  
        string action  
        string request\_hash  
        json response  
        datetime created\_at  
    }

    USERS ||--o{ SESSIONS : has  
    SESSIONS ||--o{ REFRESH\_TOKENS : rotates  
    USERS ||--o{ AUDIT\_LOGS : generates

    WORKSPACES ||--o{ WORKSPACE\_MEMBERS : contains  
    WORKSPACES ||--o{ PROJECTS : contains  
    WORKSPACES ||--o{ LABELS : owns  
    WORKSPACES ||--o{ ACTIVITIES : scopes  
    WORKSPACES ||--o{ NOTIFICATIONS : scopes

    PROJECTS ||--o{ PROJECT\_MEMBERS : contains  
    PROJECTS ||--|| PROJECT\_SETTINGS : config  
    PROJECTS ||--o{ PROJECT\_INVITATIONS : invites  
    PROJECTS ||--o{ COLUMNS : has  
    PROJECTS ||--o{ TASKS : has  
    PROJECTS ||--o{ ACTIVITIES : scopes  
    PROJECTS ||--o{ NOTIFICATIONS : scopes

    COLUMNS ||--o{ TASKS : groups  
    TASKS ||--o{ COMMENTS : has  
    TASKS ||--o{ TASK\_LABELS : tagged  
    LABELS ||--o{ TASK\_LABELS : tags  
    TASKS ||--o{ ACTIVITIES : affects  
    TASKS ||--o{ NOTIFICATIONS : affects

Lưu ý nhỏ: trong ERD trên, các liên kết từ `task` sang `users` là **logical relation** chứ không nhất thiết phải là FK vật lý trong Prisma của `task-service`.

---

# **5\. Prisma schema đề xuất – `auth-service`**

Dưới đây là bản schema gợi ý cho `apps/auth-service/prisma/schema.prisma`.

generator client {  
  provider \= "prisma-client-js"  
}

datasource db {  
  provider \= "postgresql"  
  url      \= env("DATABASE\_URL")  
}

enum UserStatus {  
  ACTIVE  
  LOCKED  
  DISABLED  
}

enum SystemRole {  
  SUPER\_ADMIN  
  SYSTEM\_ADMIN  
  USER  
}

enum SessionRevokeReason {  
  NEW\_LOGIN  
  LOGOUT  
  REFRESH\_REUSE  
  ADMIN  
  SECURITY  
}

enum AuditAction {  
  REGISTER  
  LOGIN\_OK  
  LOGIN\_FAIL  
  REFRESH\_OK  
  REFRESH\_FAIL  
  LOGOUT  
  SESSION\_REVOKED  
  SECURITY\_EVENT  
  PASSWORD\_CHANGED  
  PROFILE\_UPDATED  
  ROLE\_CHANGED  
}

model User {  
  id                     String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  email                  String      @unique @db.VarChar(255)  
  passwordHash           String      @map("password\_hash")  
  status                 UserStatus  @default(ACTIVE)  
  systemRole             SystemRole  @default(USER) @map("system\_role")

  firstName              String?     @map("first\_name") @db.VarChar(100)  
  lastName               String?     @map("last\_name") @db.VarChar(100)  
  displayName            String?     @map("display\_name") @db.VarChar(120)  
  fullName               String?     @map("full\_name") @db.VarChar(255)  
  dob                    DateTime?   @db.Date  
  avatarUrl              String?     @map("avatar\_url")  
  timezone               String?     @db.VarChar(64)  
  locale                 String?     @db.VarChar(16)

  emailVerifiedAt        DateTime?   @map("email\_verified\_at")  
  lastLoginAt            DateTime?   @map("last\_login\_at")  
  googleId               String?     @unique @map("google\_id") @db.VarChar(255)

  twoFactorEnabled       Boolean     @default(false) @map("two\_factor\_enabled")  
  twoFactorSecret        String?     @map("two\_factor\_secret")  
  twoFactorTempSecret    String?     @map("two\_factor\_temp\_secret")  
  twoFactorBackupCodes   Json?       @map("two\_factor\_backup\_codes")

  createdAt              DateTime    @default(now()) @map("created\_at")  
  updatedAt              DateTime    @updatedAt @map("updated\_at")

  sessions               Session\[\]  
  auditLogs              AuditLog\[\]

  @@index(\[status, systemRole\], map: "idx\_users\_status\_system\_role")  
  @@index(\[lastLoginAt\], map: "idx\_users\_last\_login\_at")  
  @@map("users")  
  @@schema("public")  
}

model Session {  
  id            String               @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  userId        String               @map("user\_id") @db.Uuid  
  ip            String?              @db.VarChar(64)  
  userAgent     String?              @map("user\_agent")  
  deviceId      String?              @map("device\_id") @db.VarChar(255)  
  createdAt     DateTime             @default(now()) @map("created\_at")  
  lastSeenAt    DateTime?            @map("last\_seen\_at")  
  revokedAt     DateTime?            @map("revoked\_at")  
  revokeReason  SessionRevokeReason? @map("revoke\_reason")

  user          User                 @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  refreshTokens RefreshToken\[\]

  @@index(\[userId\], map: "idx\_sessions\_user\_id")  
  @@index(\[revokedAt\], map: "idx\_sessions\_revoked\_at")  
  @@map("sessions")  
  @@schema("public")  
}

model RefreshToken {  
  id                 String        @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  sessionId          String        @map("session\_id") @db.Uuid  
  tokenHash          String        @map("token\_hash")  
  createdAt          DateTime      @default(now()) @map("created\_at")  
  expiresAt          DateTime      @map("expires\_at")  
  revokedAt          DateTime?     @map("revoked\_at")  
  replacedByTokenId  String?       @map("replaced\_by\_token\_id") @db.Uuid  
  createdByIp        String?       @map("created\_by\_ip") @db.VarChar(64)  
  createdByUserAgent String?       @map("created\_by\_user\_agent")  
  lastUsedAt         DateTime?     @map("last\_used\_at")  
  updatedAt          DateTime      @updatedAt @map("updated\_at")

  session            Session       @relation(fields: \[sessionId\], references: \[id\], onDelete: Cascade)

  @@index(\[sessionId\], map: "idx\_refresh\_tokens\_session\_id")  
  @@index(\[tokenHash\], map: "idx\_refresh\_tokens\_token\_hash")  
  @@index(\[expiresAt\], map: "idx\_refresh\_tokens\_expires\_at")  
  @@map("refresh\_tokens")  
  @@schema("public")  
}

model AuditLog {  
  id         String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  userId     String?     @map("user\_id") @db.Uuid  
  email      String?     @db.VarChar(255)  
  ip         String?     @db.VarChar(64)  
  userAgent  String?     @map("user\_agent")  
  action     AuditAction  
  detail     Json?  
  createdAt  DateTime    @default(now()) @map("created\_at")

  user       User?       @relation(fields: \[userId\], references: \[id\], onDelete: SetNull)

  @@index(\[userId, createdAt\], map: "idx\_audit\_logs\_user\_created\_at")  
  @@index(\[action, createdAt\], map: "idx\_audit\_logs\_action\_created\_at")  
  @@map("audit\_logs")  
  @@schema("public")  
}

---

# **6\. Prisma schema đề xuất – `task-service`**

Đây là bản gợi ý cho `apps/task-service/prisma/schema.prisma`.

generator client {  
  provider \= "prisma-client-js"  
}

datasource db {  
  provider \= "postgresql"  
  url      \= env("DATABASE\_URL")  
}

enum WorkspaceStatus {  
  ACTIVE  
  ARCHIVED  
}

enum MembershipStatus {  
  ACTIVE  
  INVITED  
  REMOVED  
}

enum CollabRole {  
  OWNER  
  ADMIN  
  MEMBER  
  VIEWER  
}

enum ProjectStatus {  
  ACTIVE  
  ARCHIVED  
}

enum ProjectVisibility {  
  PRIVATE  
  WORKSPACE  
}

enum ProjectViewType {  
  BOARD  
  CALENDAR  
}

enum InvitationStatus {  
  PENDING  
  ACCEPTED  
  REVOKED  
  EXPIRED  
}

enum TaskPriority {  
  LOW  
  MEDIUM  
  HIGH  
  URGENT  
}

enum TaskStatus {  
  TODO  
  IN\_PROGRESS  
  DONE  
  BLOCKED  
}

enum ActivityEntityType {  
  WORKSPACE  
  PROJECT  
  COLUMN  
  TASK  
  COMMENT  
  LABEL  
  MEMBER  
  INVITATION  
  SETTING  
}

enum NotificationType {  
  TASK\_ASSIGNED  
  TASK\_DUE\_SOON  
  TASK\_OVERDUE  
  COMMENT\_ADDED  
  PROJECT\_INVITATION  
  ROLE\_CHANGED  
  PROJECT\_ARCHIVED  
}

model Workspace {  
  id             String             @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  name           String             @db.VarChar(150)  
  slug           String             @unique @db.VarChar(180)  
  description    String?  
  ownerUserId    String             @map("owner\_user\_id") @db.Uuid  
  status         WorkspaceStatus    @default(ACTIVE)  
  createdAt      DateTime           @default(now()) @map("created\_at")  
  updatedAt      DateTime           @updatedAt @map("updated\_at")

  members        WorkspaceMember\[\]  
  projects       Project\[\]  
  labels         Label\[\]  
  activities     Activity\[\]  
  notifications  Notification\[\]

  @@index(\[ownerUserId\], map: "idx\_workspaces\_owner\_user\_id")  
  @@index(\[status\], map: "idx\_workspaces\_status")  
  @@map("workspaces")  
  @@schema("task")  
}

model WorkspaceMember {  
  workspaceId      String            @map("workspace\_id") @db.Uuid  
  userId           String            @map("user\_id") @db.Uuid  
  role             CollabRole  
  status           MembershipStatus  @default(ACTIVE)  
  invitedByUserId  String?           @map("invited\_by\_user\_id") @db.Uuid  
  joinedAt         DateTime          @default(now()) @map("joined\_at")

  workspace        Workspace         @relation(fields: \[workspaceId\], references: \[id\], onDelete: Cascade)

  @@id(\[workspaceId, userId\])  
  @@index(\[userId\], map: "idx\_workspace\_members\_user\_id")  
  @@index(\[workspaceId, role\], map: "idx\_workspace\_members\_workspace\_role")  
  @@map("workspace\_members")  
  @@schema("task")  
}

model Project {  
  id               String             @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  workspaceId      String             @map("workspace\_id") @db.Uuid  
  ownerUserId      String             @map("owner\_user\_id") @db.Uuid  
  name             String             @db.VarChar(180)  
  slug             String?            @db.VarChar(220)  
  description      String?  
  status           ProjectStatus      @default(ACTIVE)  
  visibility       ProjectVisibility  @default(PRIVATE)  
  defaultView      ProjectViewType    @default(BOARD) @map("default\_view")  
  color            String?            @db.VarChar(32)  
  icon             String?            @db.VarChar(64)  
  startDate        DateTime?          @map("start\_date") @db.Date  
  endDate          DateTime?          @map("end\_date") @db.Date  
  createdByUserId  String             @map("created\_by\_user\_id") @db.Uuid  
  updatedByUserId  String?            @map("updated\_by\_user\_id") @db.Uuid  
  archivedAt       DateTime?          @map("archived\_at")  
  createdAt        DateTime           @default(now()) @map("created\_at")  
  updatedAt        DateTime           @updatedAt @map("updated\_at")

  workspace        Workspace          @relation(fields: \[workspaceId\], references: \[id\], onDelete: Cascade)  
  members          ProjectMember\[\]  
  invitations      ProjectInvitation\[\]  
  settings         ProjectSetting?  
  columns          Column\[\]  
  tasks            Task\[\]  
  activities       Activity\[\]  
  notifications    Notification\[\]

  @@unique(\[workspaceId, slug\], map: "uq\_projects\_workspace\_slug")  
  @@index(\[workspaceId, status\], map: "idx\_projects\_workspace\_status")  
  @@index(\[ownerUserId\], map: "idx\_projects\_owner\_user\_id")  
  @@index(\[visibility\], map: "idx\_projects\_visibility")  
  @@map("projects")  
  @@schema("task")  
}

model ProjectMember {  
  projectId         String            @map("project\_id") @db.Uuid  
  userId            String            @map("user\_id") @db.Uuid  
  role              CollabRole  
  status            MembershipStatus  @default(ACTIVE)  
  invitedByUserId   String?           @map("invited\_by\_user\_id") @db.Uuid  
  joinedAt          DateTime          @default(now()) @map("joined\_at")

  project           Project           @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)

  @@id(\[projectId, userId\])  
  @@index(\[userId\], map: "idx\_project\_members\_user\_id")  
  @@index(\[projectId, role\], map: "idx\_project\_members\_project\_role")  
  @@map("project\_members")  
  @@schema("task")  
}

model ProjectInvitation {  
  id               String            @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  projectId        String            @map("project\_id") @db.Uuid  
  email            String            @db.VarChar(255)  
  role             CollabRole  
  invitedByUserId  String            @map("invited\_by\_user\_id") @db.Uuid  
  token            String            @unique  
  status           InvitationStatus  @default(PENDING)  
  expiresAt        DateTime          @map("expires\_at")  
  acceptedAt       DateTime?         @map("accepted\_at")  
  createdAt        DateTime          @default(now()) @map("created\_at")  
  updatedAt        DateTime          @updatedAt @map("updated\_at")

  project          Project           @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)

  @@index(\[projectId, status\], map: "idx\_project\_invitations\_project\_status")  
  @@index(\[email\], map: "idx\_project\_invitations\_email")  
  @@map("project\_invitations")  
  @@schema("task")  
}

model ProjectSetting {  
  projectId                String           @id @map("project\_id") @db.Uuid  
  defaultView              ProjectViewType  @default(BOARD) @map("default\_view")  
  allowMemberInvite        Boolean          @default(false) @map("allow\_member\_invite")  
  allowComment             Boolean          @default(true) @map("allow\_comment")  
  allowViewerComment       Boolean          @default(false) @map("allow\_viewer\_comment")  
  allowTaskReorder         Boolean          @default(true) @map("allow\_task\_reorder")  
  allowTaskDeleteByMember  Boolean          @default(false) @map("allow\_task\_delete\_by\_member")  
  taskPrefix               String?          @map("task\_prefix") @db.VarChar(20)  
  themeColor               String?          @map("theme\_color") @db.VarChar(32)  
  isPrivateByDefault       Boolean          @default(true) @map("is\_private\_by\_default")  
  createdAt                DateTime         @default(now()) @map("created\_at")  
  updatedAt                DateTime         @updatedAt @map("updated\_at")

  project                  Project          @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)

  @@map("project\_settings")  
  @@schema("task")  
}

model Column {  
  id               String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  projectId        String      @map("project\_id") @db.Uuid  
  name             String      @db.VarChar(120)  
  position         Int  
  createdAt        DateTime    @default(now()) @map("created\_at")  
  updatedAt        DateTime    @updatedAt @map("updated\_at")

  project          Project     @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)  
  tasks            Task\[\]

  @@unique(\[projectId, position\], map: "uq\_columns\_project\_position")  
  @@index(\[projectId\], map: "idx\_columns\_project\_id")  
  @@map("columns")  
  @@schema("task")  
}

model Task {  
  id                String         @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  projectId         String         @map("project\_id") @db.Uuid  
  columnId          String?        @map("column\_id") @db.Uuid  
  title             String         @db.VarChar(220)  
  description       String?  
  priority          TaskPriority   @default(MEDIUM)  
  status            TaskStatus     @default(TODO)  
  startAt           DateTime?      @map("start\_at")  
  dueAt             DateTime?      @map("due\_at")  
  allDay            Boolean        @default(false) @map("all\_day")  
  estimatedMinutes  Int?           @map("estimated\_minutes")  
  completedAt       DateTime?      @map("completed\_at")  
  completedByUserId String?        @map("completed\_by\_user\_id") @db.Uuid  
  assigneeUserId    String?        @map("assignee\_user\_id") @db.Uuid  
  orderIndex        Decimal        @default(0) @map("order\_index") @db.Decimal(18, 6\)  
  createdByUserId   String         @map("created\_by\_user\_id") @db.Uuid  
  archivedAt        DateTime?      @map("archived\_at")  
  createdAt         DateTime       @default(now()) @map("created\_at")  
  updatedAt         DateTime       @updatedAt @map("updated\_at")

  project           Project        @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)  
  column            Column?        @relation(fields: \[columnId\], references: \[id\], onDelete: SetNull)  
  comments          Comment\[\]  
  taskLabels        TaskLabel\[\]  
  activities        Activity\[\]  
  notifications     Notification\[\]

  @@index(\[projectId, columnId, orderIndex\], map: "idx\_tasks\_project\_column\_order")  
  @@index(\[status\], map: "idx\_tasks\_status")  
  @@index(\[dueAt\], map: "idx\_tasks\_due\_at")  
  @@index(\[assigneeUserId\], map: "idx\_tasks\_assignee\_user\_id")  
  @@index(\[archivedAt\], map: "idx\_tasks\_archived\_at")  
  @@index(\[startAt, dueAt\], map: "idx\_tasks\_calendar\_range")  
  @@map("tasks")  
  @@schema("task")  
}

model Comment {  
  id               String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  taskId           String      @map("task\_id") @db.Uuid  
  authorUserId     String      @map("author\_user\_id") @db.Uuid  
  content          String  
  createdAt        DateTime    @default(now()) @map("created\_at")  
  updatedAt        DateTime    @updatedAt @map("updated\_at")

  task             Task        @relation(fields: \[taskId\], references: \[id\], onDelete: Cascade)

  @@index(\[taskId, createdAt\], map: "idx\_comments\_task\_created\_at")  
  @@map("comments")  
  @@schema("task")  
}

model Label {  
  id               String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  workspaceId      String      @map("workspace\_id") @db.Uuid  
  name             String      @db.VarChar(80)  
  color            String      @db.VarChar(32)  
  createdAt        DateTime    @default(now()) @map("created\_at")  
  updatedAt        DateTime    @updatedAt @map("updated\_at")

  workspace        Workspace   @relation(fields: \[workspaceId\], references: \[id\], onDelete: Cascade)  
  taskLabels       TaskLabel\[\]

  @@unique(\[workspaceId, name\], map: "uq\_labels\_workspace\_name")  
  @@index(\[workspaceId\], map: "idx\_labels\_workspace\_id")  
  @@map("labels")  
  @@schema("task")  
}

model TaskLabel {  
  taskId           String      @map("task\_id") @db.Uuid  
  labelId          String      @map("label\_id") @db.Uuid  
  createdAt        DateTime    @default(now()) @map("created\_at")

  task             Task        @relation(fields: \[taskId\], references: \[id\], onDelete: Cascade)  
  label            Label       @relation(fields: \[labelId\], references: \[id\], onDelete: Cascade)

  @@id(\[taskId, labelId\])  
  @@index(\[labelId\], map: "idx\_task\_labels\_label\_id")  
  @@map("task\_labels")  
  @@schema("task")  
}

model Activity {  
  id               String             @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  workspaceId      String?            @map("workspace\_id") @db.Uuid  
  projectId        String?            @map("project\_id") @db.Uuid  
  taskId           String?            @map("task\_id") @db.Uuid  
  actorUserId      String             @map("actor\_user\_id") @db.Uuid  
  action           String             @db.VarChar(80)  
  entityType       ActivityEntityType @map("entity\_type")  
  entityId         String             @map("entity\_id") @db.VarChar(80)  
  payload          Json?  
  createdAt        DateTime           @default(now()) @map("created\_at")

  workspace        Workspace?         @relation(fields: \[workspaceId\], references: \[id\], onDelete: Cascade)  
  project          Project?           @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)  
  task             Task?              @relation(fields: \[taskId\], references: \[id\], onDelete: Cascade)

  @@index(\[workspaceId, createdAt\], map: "idx\_activities\_workspace\_created\_at")  
  @@index(\[projectId, createdAt\], map: "idx\_activities\_project\_created\_at")  
  @@index(\[taskId, createdAt\], map: "idx\_activities\_task\_created\_at")  
  @@index(\[actorUserId, createdAt\], map: "idx\_activities\_actor\_created\_at")  
  @@map("activities")  
  @@schema("task")  
}

model Notification {  
  id               String            @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  recipientUserId  String            @map("recipient\_user\_id") @db.Uuid  
  actorUserId      String?           @map("actor\_user\_id") @db.Uuid  
  workspaceId      String?           @map("workspace\_id") @db.Uuid  
  projectId        String?           @map("project\_id") @db.Uuid  
  taskId           String?           @map("task\_id") @db.Uuid  
  type             NotificationType  
  title            String            @db.VarChar(160)  
  body             String?  
  payload          Json?  
  isRead           Boolean           @default(false) @map("is\_read")  
  readAt           DateTime?         @map("read\_at")  
  createdAt        DateTime          @default(now()) @map("created\_at")

  workspace        Workspace?        @relation(fields: \[workspaceId\], references: \[id\], onDelete: Cascade)  
  project          Project?          @relation(fields: \[projectId\], references: \[id\], onDelete: Cascade)  
  task             Task?             @relation(fields: \[taskId\], references: \[id\], onDelete: Cascade)

  @@index(\[recipientUserId, isRead, createdAt\], map: "idx\_notifications\_recipient\_read\_created\_at")  
  @@index(\[projectId, createdAt\], map: "idx\_notifications\_project\_created\_at")  
  @@index(\[taskId, createdAt\], map: "idx\_notifications\_task\_created\_at")  
  @@map("notifications")  
  @@schema("task")  
}

model IdempotencyRecord {  
  id               String      @id @default(dbgenerated("gen\_random\_uuid()")) @db.Uuid  
  key              String  
  userId           String      @map("user\_id") @db.Uuid  
  action           String      @db.VarChar(80)  
  requestHash      String      @map("request\_hash")  
  response         Json?  
  createdAt        DateTime    @default(now()) @map("created\_at")

  @@unique(\[key, userId, action\], map: "uq\_idempotency\_key\_user\_action")  
  @@index(\[userId, createdAt\], map: "idx\_idempotency\_user\_created\_at")  
  @@map("idempotency\_records")  
  @@schema("task")  
}

---

# **7\. Thay đổi chính so với DB hiện tại**

Hiện tại `public.users` mới thiên về auth và mới có `full_name`, `google_id`, 2FA, session/audit; tớ mở rộng thêm cụm profile và `system_role`. Còn ở `task`, vì hiện tại đã có `workspaces`, `workspace_members`, `projects`, `project_members`, `columns`, `tasks`, `comments`, `labels`, `activities`, nên bản mới chủ yếu là **mở rộng đúng các chỗ đang thiếu**: `project_settings`, `project_invitations`, `notifications`, `visibility/default_view` của project, và `start_at/all_day/completed_at` của task.

Những thay đổi “mới hoàn toàn”:

* `users.system_role`  
* profile fields chuẩn hóa  
* `projects.visibility`  
* `projects.default_view`  
* `projects.owner_user_id`  
* `project_invitations`  
* `project_settings`  
* `tasks.start_at`  
* `tasks.all_day`  
* `tasks.completed_at`  
* `notifications`

---

# **8\. Gợi ý migration strategy**

Tớ khuyên theo 4 bước để đỡ gãy:

Bước 1: mở rộng `public.users` theo hướng additive.  
Đừng xóa `full_name` ngay, cứ giữ tạm cho UI cũ.

Bước 2: mở rộng `task.projects` và `task.tasks`.  
Set mặc định:

* `visibility = PRIVATE`  
* `default_view = BOARD`  
* `all_day = false`

Bước 3: tạo bảng mới:

* `project_settings`  
* `project_invitations`  
* `notifications`

Bước 4: backfill dữ liệu:

* với mỗi project cũ, tạo 1 record `project_settings`  
* với mỗi workspace/project hiện tại, đảm bảo owner có membership `OWNER`  
* nếu task cũ chỉ có `due_at`, thì `start_at = null`

---

# **9\. Gợi ý API sẽ khớp với schema này**

Để schema này thật sự “dùng được”, phía sau nó nên có tối thiểu các nhóm endpoint:

## **Auth / Profile**

* `GET /api/v1/auth/me`  
* `PATCH /api/v1/auth/profile`  
* `POST /api/v1/auth/change-password`  
* `GET /api/v1/auth/sessions`  
* `POST /api/v1/auth/sessions/:id/revoke`

## **Workspaces**

* `POST /api/v1/workspaces`  
* `GET /api/v1/workspaces/:id`  
* `GET /api/v1/workspaces/:id/members`  
* `PATCH /api/v1/workspaces/:id/members/:userId/role`

## **Projects**

* `POST /api/v1/projects`  
* `GET /api/v1/projects/:id`  
* `PATCH /api/v1/projects/:id`  
* `PATCH /api/v1/projects/:id/settings`  
* `POST /api/v1/projects/:id/invitations`  
* `POST /api/v1/projects/invitations/:token/accept`

## **Tasks**

* `POST /api/v1/tasks`  
* `PATCH /api/v1/tasks/:id`  
* `PATCH /api/v1/tasks/:id/move`  
* `GET /api/v1/projects/:id/board`  
* `GET /api/v1/projects/:id/calendar`

## **Notifications**

* `GET /api/v1/notifications`  
* `GET /api/v1/notifications/unread-count`  
* `PATCH /api/v1/notifications/:id/read`  
* `PATCH /api/v1/notifications/read-all`

