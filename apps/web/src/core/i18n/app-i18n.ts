const SETTINGS_KEY = 'orbitSettings';

export type SupportedLanguage = 'en' | 'vi';

type SetLanguageOptions = {
  persist?: boolean;
  reload?: boolean;
};

export type OrbitI18nCompat = {
  getLanguage: () => SupportedLanguage;
  setLanguage: (language: string, options?: SetLanguageOptions) => SupportedLanguage;
  t: (text: string) => string;
  apply: (root?: Node | null) => void;
  installAutoTranslate: () => void;
};

type PatternRule = {
  pattern: RegExp;
  replace: (match: RegExpMatchArray) => string;
};

const VI_TRANSLATIONS: Record<string, string> = {
  'Hello - Sign In': 'Hello - Đăng nhập',
  'Hello - Sign Up': 'Hello - Đăng ký',
  'Hello - Workspaces': 'Hello - Không gian làm việc',
  'Hello - Settings': 'Hello - Cài đặt',
  'Hello - Organize Your Universe': 'Hello - Tổ chức vũ trụ công việc của bạn',
  'Authenticating': 'Đang xác thực',
  'Authentication Failed': 'Xác thực thất bại',
  'Validating your login session...': 'Đang xác thực phiên đăng nhập của bạn...',
  'Sign in to Hello': 'Đăng nhập vào Hello',
  'Use your email or Google account to continue.': 'Dùng email hoặc tài khoản Google để tiếp tục.',
  'Create your account': 'Tạo tài khoản của bạn',
  'Sign up with email or Google and go straight to your workspace.': 'Đăng ký bằng email hoặc Google và vào ngay không gian làm việc.',
  'Email address': 'Địa chỉ email',
  Password: 'Mật khẩu',
  'Sign In': 'Đăng nhập',
  'Create Account': 'Tạo tài khoản',
  "Don't have an account?": 'Chưa có tài khoản?',
  'Already have an account?': 'Đã có tài khoản?',
  'First name': 'Tên',
  'Last name (optional)': 'Họ (không bắt buộc)',
  'Confirm Password': 'Xác nhận mật khẩu',
  'Password must contain:': 'Mật khẩu phải có:',
  'At least 8 characters': 'Ít nhất 8 ký tự',
  'An uppercase letter': 'Một chữ in hoa',
  'A lowercase letter': 'Một chữ thường',
  'A number': 'Một chữ số',
  or: 'hoặc',
  'Continue with Google': 'Tiếp tục với Google',
  'Forgot password?': 'Quên mật khẩu?',
  'Reset your password': 'Đặt lại mật khẩu',
  'Request a code, verify it, then set a new password.': 'Yêu cầu mã, xác minh, rồi đặt mật khẩu mới.',
  'Send code': 'Gửi mã',
  'Send new code': 'Gửi mã mới',
  'Verify code': 'Xác minh mã',
  'Reset password': 'Đặt lại mật khẩu',
  'Back to sign in': 'Quay lại đăng nhập',
  'Back to Password Sign-In': 'Quay lại đăng nhập bằng mật khẩu',
  '6-digit code': 'Mã 6 chữ số',
  '6-digit one-time code': 'Mã OTP 6 chữ số',
  'Backup code (optional)': 'Mã dự phòng (không bắt buộc)',
  'Two-factor verification is required.': 'Yêu cầu xác minh hai lớp.',
  'Enter a one-time code or backup code.': 'Nhập mã OTP hoặc mã dự phòng.',
  'Verifying code...': 'Đang xác minh mã...',
  'Signing in...': 'Đang đăng nhập...',
  'Redirecting to Google...': 'Đang chuyển hướng đến Google...',
  'Google sign-in failed.': 'Đăng nhập Google thất bại.',
  'Google sign-up failed.': 'Đăng ký Google thất bại.',
  'Enter a valid email address.': 'Vui lòng nhập địa chỉ email hợp lệ.',
  'Please enter a valid email address.': 'Vui lòng nhập địa chỉ email hợp lệ.',
  'Enter the 6-digit code from your email.': 'Nhập mã 6 chữ số từ email của bạn.',
  'Verify your email code before creating your account.': 'Xác minh mã email trước khi tạo tài khoản.',
  'Verify your email code before resetting your password.': 'Xác minh mã email trước khi đặt lại mật khẩu.',
  'Email verification is currently unavailable.': 'Xác minh email hiện không khả dụng.',
  'Unable to send verification code.': 'Không thể gửi mã xác minh.',
  'Unable to verify code.': 'Không thể xác minh mã.',
  'Unable to reset password.': 'Không thể đặt lại mật khẩu.',
  'Unable to create account.': 'Không thể tạo tài khoản.',
  'Incorrect email or password.': 'Email hoặc mật khẩu không chính xác.',
  'The authentication service is temporarily unavailable. Please try again.': 'Dịch vụ xác thực tạm thời không khả dụng. Vui lòng thử lại.',
  'Passwords do not match.': 'Mật khẩu không khớp.',
  'Password reset successful. Sign in with your new password.': 'Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.',
  'My Workspaces': 'Không gian làm việc của tôi',
  'New Workspace': 'Không gian làm việc mới',
  WORKSPACE: 'KHÔNG GIAN LÀM VIỆC',
  'Search tasks...': 'Tìm kiếm công việc...',
  'All Statuses': 'Tất cả trạng thái',
  'All Members': 'Tất cả thành viên',
  'Not Started': 'Chưa bắt đầu',
  'In Progress': 'Đang thực hiện',
  Done: 'Hoàn thành',
  Dropped: 'Đã dừng',
  TIMELINE: 'DÒNG THỜI GIAN',
  'New Task': 'Công việc mới',
  'Task Name': 'Tên công việc',
  Start: 'Bắt đầu',
  End: 'Kết thúc',
  Status: 'Trạng thái',
  Priority: 'Ưu tiên',
  Low: 'Thấp',
  Medium: 'Trung bình',
  High: 'Cao',
  Notes: 'Ghi chú',
  'Image URL': 'URL hình ảnh',
  'Choose File': 'Chọn tệp',
  'Assign to': 'Giao cho',
  'Delete Task': 'Xóa công việc',
  Abort: 'Hủy',
  Confirm: 'Xác nhận',
  'Edit Task': 'Chỉnh sửa công việc',
  'Set: Not Started': 'Đặt: Chưa bắt đầu',
  'Set: In Progress': 'Đặt: Đang thực hiện',
  'Set: Done': 'Đặt: Hoàn thành',
  'Set: Dropped': 'Đặt: Đã dừng',
  Cancel: 'Hủy',
  OK: 'Đồng ý',
  'Workspace Settings': 'Cài đặt không gian làm việc',
  'Workspace Name': 'Tên không gian làm việc',
  'Start Date': 'Ngày bắt đầu',
  'End Date': 'Ngày kết thúc',
  'Hour Format': 'Định dạng giờ',
  'Show Weekends': 'Hiển thị cuối tuần',
  'Start of Week': 'Bắt đầu tuần',
  Monday: 'Thứ Hai',
  Sunday: 'Chủ nhật',
  'Default Task Duration (Hours)': 'Thời lượng mặc định của công việc (giờ)',
  'Delete Workspace': 'Xóa không gian làm việc',
  'Workspace Created': 'Đã tạo không gian làm việc',
  'Workspace Create Failed': 'Tạo không gian làm việc thất bại',
  'Workspace Unavailable': 'Không gian làm việc không khả dụng',
  'Workspace Busy': 'Không gian làm việc đang bận',
  'Workspace Error': 'Lỗi không gian làm việc',
  'Project Error': 'Lỗi dự án',
  'Task Error': 'Lỗi công việc',
  'Load Failed': 'Tải dữ liệu thất bại',
  'Update Failed': 'Cập nhật thất bại',
  'Delete Unavailable': 'Tính năng xóa không khả dụng',
  'Permission Denied': 'Không có quyền',
  'Unable to load workspaces from server. Please refresh or try again.':
    'Không thể tải danh sách không gian làm việc từ máy chủ. Vui lòng làm mới hoặc thử lại.',
  'Please select a project before creating a task.':
    'Vui lòng chọn một dự án trước khi tạo công việc.',
  'You do not have permission to create tasks in this project.':
    'Bạn không có quyền tạo công việc trong dự án này.',
  'No accessible workspace board found.':
    'Không tìm thấy bảng không gian làm việc mà bạn có thể truy cập.',
  'Select a workspace first.': 'Vui lòng chọn một không gian làm việc trước.',
  'Workspace settings form is unavailable. Please refresh this page.':
    'Biểu mẫu cài đặt không gian làm việc hiện không khả dụng. Vui lòng làm mới trang.',
  'You need to sign in before creating a workspace.':
    'Bạn cần đăng nhập trước khi tạo không gian làm việc.',
  'Workspace creation is already in progress. Please wait a moment.':
    'Quá trình tạo không gian làm việc đang diễn ra. Vui lòng chờ.',
  'Workspace created successfully.': 'Đã tạo không gian làm việc thành công.',
  'Unable to create workspace right now. Please try again.':
    'Hiện không thể tạo không gian làm việc. Vui lòng thử lại.',
  'Workspace update is already in progress. Please wait a moment.':
    'Quá trình cập nhật không gian làm việc đang diễn ra. Vui lòng chờ.',
  'Unable to save workspace settings to the server. The dashboard has been reloaded from the latest saved data.':
    'Không thể lưu cài đặt không gian làm việc lên máy chủ. Bảng điều khiển đã được tải lại từ dữ liệu đã lưu mới nhất.',
  'Only workspace owner can delete this workspace.':
    'Chỉ chủ sở hữu không gian làm việc mới có thể xóa không gian này.',
  'Unable to load project members right now.':
    'Hiện không thể tải danh sách thành viên dự án.',
  'Unable to update project settings right now.':
    'Hiện không thể cập nhật cài đặt dự án.',
  'Unable to save project policy settings.':
    'Không thể lưu cài đặt chính sách dự án.',
  'Create or select a workspace before adding tasks.':
    'Hãy tạo hoặc chọn không gian làm việc trước khi thêm công việc.',
  'You do not have permission to create tasks in this workspace.':
    'Bạn không có quyền tạo công việc trong không gian làm việc này.',
  'No active workspace selected.': 'Chưa chọn không gian làm việc đang hoạt động.',
  'You do not have permission to edit tasks in this workspace.':
    'Bạn không có quyền chỉnh sửa công việc trong không gian làm việc này.',
  'Task data is missing.': 'Thiếu dữ liệu công việc.',
  'You do not have permission to delete tasks in this workspace.':
    'Bạn không có quyền xóa công việc trong không gian làm việc này.',
  'You do not have permission to resize tasks in this project.':
    'Bạn không có quyền thay đổi kích thước công việc trong dự án này.',
  'No active project selected.': 'Chưa chọn dự án đang hoạt động.',
  'Invalid task status requested.': 'Trạng thái công việc yêu cầu không hợp lệ.',
  'You do not have permission to change task status.':
    'Bạn không có quyền thay đổi trạng thái công việc.',
  'Task no longer exists. Please refresh and try again.':
    'Công việc không còn tồn tại. Vui lòng làm mới và thử lại.',
  'You do not have permission to move tasks in this project.':
    'Bạn không có quyền di chuyển công việc trong dự án này.',
  'Workspace identifier is invalid. Please refresh and try again.':
    'Mã định danh không gian làm việc không hợp lệ. Vui lòng làm mới và thử lại.',
  'Workspace delete is unavailable. Please sign in again and retry.':
    'Tính năng xóa không gian làm việc hiện không khả dụng. Vui lòng đăng nhập lại và thử lại.',
  'Workspace deletion is already running. Please wait.':
    'Quá trình xóa không gian làm việc đang diễn ra. Vui lòng chờ.',
  'Workspace deleted successfully.': 'Đã xóa không gian làm việc thành công.',
  'Project not found or no longer accessible.':
    'Không tìm thấy dự án hoặc bạn không còn quyền truy cập.',
  'No Workspace': 'Không có không gian làm việc',
  'No workspaces yet': 'Chưa có không gian làm việc',
  'Use New Workspace in the sidebar to create your first workspace.':
    'Dùng "Không gian làm việc mới" ở thanh bên để tạo không gian làm việc đầu tiên.',
  'No tasks yet': 'Chưa có công việc',
  'No matching tasks': 'Không có công việc phù hợp',
  'Adjust search or filters to see tasks.':
    'Hãy điều chỉnh tìm kiếm hoặc bộ lọc để xem công việc.',
  'Click any time slot in the calendar to create your first task.':
    'Nhấn vào một khung giờ trên lịch để tạo công việc đầu tiên.',
  'Read only': 'Chỉ xem',
  '+ Add Task': '+ Thêm công việc',
  Save: 'Lưu',
  Create: 'Tạo',
  Settings: 'Cài đặt',
  CONFIGURATION: 'CẤU HÌNH',
  'Save Changes': 'Lưu thay đổi',
  Appearance: 'Giao diện',
  Notifications: 'Thông báo',
  Account: 'Tài khoản',
  Background: 'Nền',
  'Custom Wallpaper': 'Hình nền tùy chỉnh',
  Upload: 'Tải lên',
  Remove: 'Xóa',
  Interface: 'Giao diện',
  'Accent Color': 'Màu nhấn',
  Alerts: 'Cảnh báo',
  Profile: 'Hồ sơ',
  'Edit Profile': 'Chỉnh sửa hồ sơ',
  Preferences: 'Tùy chọn',
  Language: 'Ngôn ngữ',
  English: 'Tiếng Anh',
  Vietnamese: 'Tiếng Việt',
  Timezone: 'Múi giờ',
  'Auto-save': 'Tự động lưu',
  'Security (2FA)': 'Bảo mật (2FA)',
  'Two-Factor Authentication': 'Xác thực hai lớp',
  'Status: Not enabled': 'Trạng thái: Chưa bật',
  'Start Setup': 'Bắt đầu thiết lập',
  'Confirm 2FA': 'Xác nhận 2FA',
  'Disable 2FA': 'Tắt 2FA',
  'Change Password': 'Đổi mật khẩu',
  Data: 'Dữ liệu',
  'Export All Data': 'Xuất toàn bộ dữ liệu',
  'Clear All Tasks': 'Xóa toàn bộ công việc',
  'Reset to Defaults': 'Khôi phục mặc định',
  'Sign Out': 'Đăng xuất',
  'Save Profile': 'Lưu hồ sơ',
  'Settings saved successfully': 'Lưu cài đặt thành công',
  'Saved!': 'Đã lưu!',
  'Settings reset to defaults': 'Đã đặt lại cài đặt về mặc định',
  'Local settings were saved, but workspace settings could not be updated':
    'Đã lưu cài đặt cục bộ, nhưng không thể cập nhật cài đặt không gian làm việc',
  'Local settings were reset, but workspace settings could not be updated':
    'Đã đặt lại cài đặt cục bộ, nhưng không thể cập nhật cài đặt không gian làm việc',
  'Workspace settings are unavailable': 'Cài đặt không gian làm việc hiện không khả dụng',
  'Unable to load workspace settings': 'Không thể tải cài đặt không gian làm việc',
  'No role changes to save': 'Không có thay đổi vai trò để lưu',
  'Confirm Role Update': 'Xác nhận cập nhật vai trò',
  'Workspace member updated': 'Đã cập nhật thành viên không gian làm việc',
  'Confirm Member Removal': 'Xác nhận xóa thành viên',
  'Workspace member removed': 'Đã xóa thành viên khỏi không gian làm việc',
  'You do not have permission to invite members': 'Bạn không có quyền mời thành viên',
  'Please enter a valid email': 'Vui lòng nhập email hợp lệ',
  'Selected role is not allowed for your workspace permission':
    'Vai trò đã chọn không phù hợp với quyền của bạn trong không gian làm việc',
  'Workspace unavailable': 'Không gian làm việc hiện không khả dụng',
  'Workspace member added': 'Đã thêm thành viên vào không gian làm việc',
  'Email not registered': 'Email chưa được đăng ký',
  'Profile updated': 'Đã cập nhật hồ sơ',
  'Please select an image file': 'Vui lòng chọn tệp ảnh',
  'Wallpaper applied': 'Đã áp dụng hình nền',
  'Background removed': 'Đã xóa hình nền',
  'Accent color updated': 'Đã cập nhật màu nhấn',
  'Avatar updated': 'Đã cập nhật ảnh đại diện',
  '2FA setup is unavailable.': 'Thiết lập 2FA hiện không khả dụng.',
  'Starting 2FA setup...': 'Đang bắt đầu thiết lập 2FA...',
  'Unable to start 2FA setup.': 'Không thể bắt đầu thiết lập 2FA.',
  'Scan the QR code, then enter OTP to confirm 2FA.':
    'Quét mã QR rồi nhập OTP để xác nhận 2FA.',
  '2FA confirm is unavailable.': 'Xác nhận 2FA hiện không khả dụng.',
  'Please start setup first.': 'Vui lòng bắt đầu thiết lập trước.',
  'OTP must be exactly 6 digits.': 'OTP phải đúng 6 chữ số.',
  'Unable to confirm 2FA.': 'Không thể xác nhận 2FA.',
  'No backup codes returned.': 'Không có mã dự phòng được trả về.',
  '2FA enabled successfully. Save your backup codes now.':
    'Bật 2FA thành công. Hãy lưu mã dự phòng ngay bây giờ.',
  '2FA disable is unavailable.': 'Tắt 2FA hiện không khả dụng.',
  'Provide OTP or backup code to disable 2FA.':
    'Cung cấp OTP hoặc mã dự phòng để tắt 2FA.',
  'Unable to disable 2FA.': 'Không thể tắt 2FA.',
  '2FA disabled.': 'Đã tắt 2FA.',
  'Password change is unavailable.': 'Đổi mật khẩu hiện không khả dụng.',
  'Current password and new password are required.':
    'Cần nhập mật khẩu hiện tại và mật khẩu mới.',
  'New password confirmation does not match.': 'Xác nhận mật khẩu mới không khớp.',
  'New password must include uppercase, lowercase, number and min 8 chars.':
    'Mật khẩu mới phải có chữ hoa, chữ thường, số và tối thiểu 8 ký tự.',
  '2FA is enabled. Provide OTP or backup code.':
    '2FA đã bật. Hãy cung cấp OTP hoặc mã dự phòng.',
  'Changing password...': 'Đang đổi mật khẩu...',
  'Unable to change password.': 'Không thể đổi mật khẩu.',
  'Password changed. Please sign in again.':
    'Đã đổi mật khẩu. Vui lòng đăng nhập lại.',
  'Data exported': 'Đã xuất dữ liệu',
  'Export failed': 'Xuất dữ liệu thất bại',
  'Confirm Clear Tasks': 'Xác nhận xóa công việc',
  'Clear all tasks from every workspace? This cannot be undone.':
    'Xóa tất cả công việc khỏi mọi không gian làm việc? Hành động này không thể hoàn tác.',
  'All tasks cleared': 'Đã xóa toàn bộ công việc',
  'Failed to clear tasks': 'Xóa công việc thất bại',
  'Confirm Reset Settings': 'Xác nhận đặt lại cài đặt',
  'Reset all settings to defaults?': 'Đặt lại toàn bộ cài đặt về mặc định?',
  'Confirm Sign Out': 'Xác nhận đăng xuất',
  'Sign out now?': 'Đăng xuất ngay bây giờ?',
  '2FA enabled': 'Đã bật 2FA',
  '2FA disabled': 'Đã tắt 2FA',
  'Password changed': 'Đã đổi mật khẩu',
  'System Admin Dashboard': 'Bảng điều khiển quản trị hệ thống',
  'SYSTEM GOVERNANCE': 'QUẢN TRỊ HỆ THỐNG',
  'Realtime: Offline': 'Thời gian thực: Ngoại tuyến',
  'Realtime: Connected': 'Thời gian thực: Đã kết nối',
  'Realtime: Reconnecting...': 'Thời gian thực: Đang kết nối lại...',
  'Back to Home': 'Quay lại trang chủ',
  Refresh: 'Làm mới',
  'Security Dashboard': 'Bảng điều khiển bảo mật',
  'Realtime Events': 'Sự kiện thời gian thực',
  'User Management': 'Quản lý người dùng',
  'Audit Explorer': 'Trình xem nhật ký kiểm toán',
  'Workspace Management': 'Quản lý không gian làm việc',
  'Reporting Export': 'Xuất báo cáo',
  'Workspace ID': 'ID không gian làm việc',
  'Export CSV': 'Xuất CSV',
  Loading: 'Đang tải',
  'Loading...': 'Đang tải...',
  'No users found': 'Không tìm thấy người dùng',
  'No audit logs': 'Không có nhật ký kiểm toán',
  'No workspaces found': 'Không tìm thấy không gian làm việc',
  ACTIVE: 'HOẠT ĐỘNG',
  LOCKED: 'BỊ KHÓA',
  DISABLED: 'VÔ HIỆU HÓA',
  USER: 'NGƯỜI DÙNG',
  SYSTEM_ADMIN: 'QUẢN TRỊ HỆ THỐNG',
  SUPER_ADMIN: 'SIÊU QUẢN TRỊ',
  Enabled: 'Đã bật',
  Off: 'Tắt',
  'Load more users': 'Xem thêm người dùng',
  'Load more logs': 'Xem thêm nhật ký',
  'Load more workspaces': 'Xem thêm không gian làm việc',
  'Search by email/name': 'Tìm theo email/tên',
  'Action (e.g LOGIN_FAIL)': 'Hành động (ví dụ: LOGIN_FAIL)',
  'Email contains': 'Email chứa',
  'Latest updates from server': 'Các cập nhật mới nhất từ máy chủ',
  'Waiting for realtime events...': 'Đang chờ sự kiện thời gian thực...',
  'All workspaces in the system': 'Toàn bộ không gian làm việc trong hệ thống',
  'Enter workspace id then click export.': 'Nhập ID không gian làm việc rồi bấm xuất.',
  Sessions: 'Phiên',
  Delete: 'Xóa',
  Apply: 'Áp dụng',
  Close: 'Đóng',
  'Delete User': 'Xóa người dùng',
  Revoke: 'Thu hồi',
  'Revoke Sessions': 'Thu hồi phiên',
  'Organize tasks like constellations - everything in its orbit, nothing out of place.':
    'Sắp xếp công việc như các chòm sao - mọi thứ đúng quỹ đạo, không gì lạc chỗ.',
  'Get Started': 'Bắt đầu',
  'About us': 'Về chúng tôi',
  'Your Board, Your Galaxy': 'Bảng của bạn, thiên hà của bạn',
  Ideas: 'Ý tưởng',
  'Our Mission': 'Sứ mệnh của chúng tôi',
  'Our Team': 'Đội ngũ của chúng tôi',
  'Contact Us': 'Liên hệ với chúng tôi',
  'About Us': 'Về chúng tôi',
};

const VI_PATTERN_RULES: PatternRule[] = [
  {
    pattern: /^Resend in (\d+)s$/i,
    replace: (match) => `Gửi lại sau ${match[1]}s`,
  },
  {
    pattern: /^Please wait (\d+) seconds before requesting another code\.$/i,
    replace: (match) => `Vui lòng chờ ${match[1]} giây trước khi yêu cầu mã mới.`,
  },
  {
    pattern: /^Too many sign-in attempts\. Try again in (\d+) seconds\.$/i,
    replace: (match) => `Quá nhiều lần đăng nhập. Vui lòng thử lại sau ${match[1]} giây.`,
  },
  {
    pattern: /^Verification code sent to (.+)\.$/i,
    replace: (match) => `Đã gửi mã xác minh đến ${match[1]}.`,
  },
  {
    pattern: /^Load more users \((\d+)\/(\d+)\)$/i,
    replace: (match) => `Xem thêm người dùng (${match[1]}/${match[2]})`,
  },
  {
    pattern: /^All users loaded \((\d+)\)$/i,
    replace: (match) => `Đã tải hết người dùng (${match[1]})`,
  },
  {
    pattern: /^Load more logs \((\d+)\/(\d+)\)$/i,
    replace: (match) => `Xem thêm nhật ký (${match[1]}/${match[2]})`,
  },
  {
    pattern: /^All logs loaded \((\d+)\)$/i,
    replace: (match) => `Đã tải hết nhật ký (${match[1]})`,
  },
  {
    pattern: /^Load more workspaces \((\d+)\/(\d+)\)$/i,
    replace: (match) => `Xem thêm không gian làm việc (${match[1]}/${match[2]})`,
  },
  {
    pattern: /^All workspaces loaded \((\d+)\)$/i,
    replace: (match) => `Đã tải hết không gian làm việc (${match[1]})`,
  },
  {
    pattern: /^Exported (.+)$/i,
    replace: (match) => `Đã xuất ${match[1]}`,
  },
  {
    pattern: /^Due (.+)$/i,
    replace: (match) => `Hạn ${match[1]}`,
  },
];

function normalizeLanguage(value: unknown): SupportedLanguage {
  return String(value || '').trim().toLowerCase() === 'vi' ? 'vi' : 'en';
}

function normalizeLookupKey(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readStoredLanguage(): SupportedLanguage {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return 'en';
    const parsed = JSON.parse(raw) as { account?: { language?: string } };
    return normalizeLanguage(parsed?.account?.language);
  } catch {
    return 'en';
  }
}

function persistStoredLanguage(language: SupportedLanguage): void {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const account =
      parsed.account && typeof parsed.account === 'object'
        ? parsed.account as Record<string, unknown>
        : {};

    account.language = language;
    parsed.account = account;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // ignore localStorage failures
  }
}

function setHtmlLanguage(language: SupportedLanguage): void {
  document.documentElement.setAttribute('lang', language === 'vi' ? 'vi' : 'en');
}

function buildI18n(): OrbitI18nCompat {
  let activeLanguage: SupportedLanguage = readStoredLanguage();
  let observer: MutationObserver | null = null;
  let isApplying = false;

  const translate = (text: string): string => {
    const source = String(text || '');
    if (!source || activeLanguage !== 'vi') {
      return source;
    }

    const codeMatch = source.match(/^(\[[A-Z0-9_]+\]\s+)(.+)$/);
    if (codeMatch) {
      const translatedMessage = translate(codeMatch[2]);
      return translatedMessage === codeMatch[2] ? source : `${codeMatch[1]}${translatedMessage}`;
    }

    const direct = VI_TRANSLATIONS[source];
    if (direct) return direct;

    const normalized = normalizeLookupKey(source);
    if (VI_TRANSLATIONS[normalized]) {
      return VI_TRANSLATIONS[normalized];
    }

    for (const rule of VI_PATTERN_RULES) {
      const match = normalized.match(rule.pattern);
      if (match) {
        return rule.replace(match);
      }
    }

    return source;
  };

  const translateTextNode = (node: Text): void => {
    if (activeLanguage !== 'vi') return;
    if (!node.nodeValue || isApplying) return;
    if (node.parentElement?.closest('[data-no-i18n="true"]')) return;

    const raw = node.nodeValue;
    const core = raw.trim();
    if (!core) return;

    const translated = translate(core);
    if (!translated || translated === core) return;

    const leading = raw.match(/^\s*/)?.[0] || '';
    const trailing = raw.match(/\s*$/)?.[0] || '';
    isApplying = true;
    node.nodeValue = `${leading}${translated}${trailing}`;
    isApplying = false;
  };

  const translateAttributes = (element: Element): void => {
    if (activeLanguage !== 'vi' || isApplying) return;
    if (!(element instanceof HTMLElement)) return;

    const attributeNames = ['placeholder', 'title', 'aria-label'];
    for (const attributeName of attributeNames) {
      const value = element.getAttribute(attributeName);
      if (!value) continue;
      const translated = translate(value);
      if (!translated || translated === value) continue;
      isApplying = true;
      element.setAttribute(attributeName, translated);
      isApplying = false;
    }

    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if ((inputType === 'button' || inputType === 'submit' || inputType === 'reset') && element.value) {
        const translated = translate(element.value);
        if (translated && translated !== element.value) {
          isApplying = true;
          element.value = translated;
          isApplying = false;
        }
      }
    }
  };

  const applyTranslations = (root?: Node | null): void => {
    if (activeLanguage !== 'vi') return;

    const target = root || document.body || document.documentElement;
    if (!target) return;

    if (target.nodeType === Node.TEXT_NODE) {
      translateTextNode(target as Text);
      return;
    }

    if (target.nodeType === Node.ELEMENT_NODE) {
      translateAttributes(target as Element);
    }

    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current: Node | null = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        translateTextNode(current as Text);
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        translateAttributes(current as Element);
      }
      current = walker.nextNode();
    }
  };

  const installAutoTranslate = (): void => {
    if (observer || typeof MutationObserver === 'undefined') return;

    const startObserver = () => {
      if (!document.body || observer) return;
      observer = new MutationObserver((mutations) => {
        if (activeLanguage !== 'vi' || isApplying) return;
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            translateTextNode(mutation.target as Text);
            continue;
          }
          if (mutation.type === 'attributes') {
            if (mutation.target.nodeType === Node.ELEMENT_NODE) {
              translateAttributes(mutation.target as Element);
            }
            continue;
          }
          mutation.addedNodes.forEach((node) => applyTranslations(node));
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'title', 'aria-label', 'value'],
      });
    };

    if (document.body) {
      startObserver();
    } else {
      window.addEventListener('DOMContentLoaded', startObserver, { once: true });
    }
  };

  const setLanguage = (language: string, options: SetLanguageOptions = {}): SupportedLanguage => {
    const nextLanguage = normalizeLanguage(language);
    const changed = nextLanguage !== activeLanguage;
    activeLanguage = nextLanguage;

    if (options.persist !== false) {
      persistStoredLanguage(nextLanguage);
    }

    setHtmlLanguage(nextLanguage);
    if (nextLanguage === 'vi') {
      applyTranslations(document.body);
    }

    if (changed && options.reload === true) {
      window.location.reload();
    }

    return activeLanguage;
  };

  setHtmlLanguage(activeLanguage);

  return {
    getLanguage: () => activeLanguage,
    setLanguage,
    t: translate,
    apply: applyTranslations,
    installAutoTranslate,
  };
}

declare global {
  interface Window {
    OrbitI18n?: OrbitI18nCompat;
  }
}

export function bootstrapAppI18n(): OrbitI18nCompat {
  if (window.OrbitI18n) {
    return window.OrbitI18n;
  }

  const i18n = buildI18n();
  window.OrbitI18n = i18n;
  i18n.installAutoTranslate();

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        i18n.apply(document.body);
      },
      { once: true },
    );
  } else {
    i18n.apply(document.body);
  }

  return i18n;
}
