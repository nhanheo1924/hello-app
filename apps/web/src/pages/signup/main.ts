import { registerLegacyGlobals } from '../../legacy/register-globals';

registerLegacyGlobals();
await import('../../../signup/signup.js');
