import { registerLegacyGlobals } from '../../legacy/register-globals';
import { mountAdminShortcut } from '../../modules/governance/admin-shortcut';
import { mountNotificationWidget } from '../../modules/governance/notification-widget';
import { mountHeaderHub } from '../../modules/workspace/header-hub';

registerLegacyGlobals();
await mountAdminShortcut();
mountHeaderHub();
mountNotificationWidget();
await import('../../../home/project.js');
