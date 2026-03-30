import { registerLegacyGlobals } from '../../legacy/register-globals';

registerLegacyGlobals();
await import('../../../landing/landingpage.js');
