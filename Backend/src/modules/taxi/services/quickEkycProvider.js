/**
 * QuickeKYC client - the only file that knows the vendor's wire format.
 *
 * QuickeKYC's reference is behind their dashboard login, so the base URL,
 * endpoint paths and how the key is sent are admin settings (Settings ->
 * User Verification) rather than constants. The request field names below
 * follow the usual Indian KYC API shape (`id_number`, `request_id`, `otp`);
 * if QuickeKYC's docs differ, this file is the one place to change.
 *
 * `environment: 'mock'` never calls the network: any well-formed number
 * passes and the Aadhaar OTP is 123456. It exists so the whole flow can be
 * built and tested before live keys are issued.
 */

export const QUICKEKYC_DEFAULTS = Object.freeze({
  environment: 'mock', // mock | sandbox | live
  base_url: 'https://api.quickekyc.com/api/v1',
  api_key: '',
  // 'body' sends `{ [auth_field]: api_key }` in every request; 'header' sends
  // `auth_field: <prefix> api_key`.
  auth_mode: 'body',
  auth_field: 'key',
  auth_prefix: '',
  timeout_ms: 20000,
  endpoints: {
    aadhaar_generate_otp: '/aadhaar-v2/generate-otp',
    aadhaar_submit_otp: '/aadhaar-v2/submit-otp',
    pan: '/pan/pan',
    driving_license: '/driving-license/driving-license',
    voter_id: '/voter-id/voter-id',
  },
});

export const MOCK_AADHAAR_OTP = '123456';

export class KycProviderError extends Error {
  constructor(message, { status = 502, code = 'KYC_PROVIDER_ERROR', retryable = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const pick = (source, keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), source);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const isSuccessful = (body = {}) => {
  const status = String(body.status ?? '').toLowerCase();
  return body.success === true ||
    status === 'success' ||
    status === 'true' ||
    Number(body.status_code) === 200 ||
    Number(body.statusCode) === 200;
};

const readMessage = (body = {}) =>
  String(pick(body, ['message', 'msg', 'error', 'data.message', 'error.message']) || 'Verification failed');

/// Fields every provider response is reduced to. Unknown extras are dropped.
const normalizeIdentity = (body = {}) => {
  const data = body.data || body.result || body;
  return {
    name: String(pick(data, ['full_name', 'name', 'name_on_card', 'name_as_per_aadhaar', 'holder_name', 'name_full']) || ''),
    dob: String(pick(data, ['dob', 'date_of_birth', 'birth_date']) || ''),
    gender: String(pick(data, ['gender']) || ''),
    providerRef: String(pick(body, ['request_id', 'client_id', 'reference_id', 'data.request_id', 'data.client_id', 'data.reference_id']) || ''),
  };
};

const mockIdentity = (documentType) => ({
  name: 'Test User',
  dob: '1990-01-01',
  gender: 'M',
  providerRef: `mock-${documentType}-${Date.now()}`,
});

export const createQuickEkycClient = (rawConfig = {}) => {
  const config = {
    ...QUICKEKYC_DEFAULTS,
    ...rawConfig,
    endpoints: { ...QUICKEKYC_DEFAULTS.endpoints, ...(rawConfig.endpoints || {}) },
  };
  const isMock = config.environment === 'mock';

  const call = async (endpointKey, body) => {
    if (!config.api_key) {
      throw new KycProviderError('QuickeKYC API key is not configured', { status: 503, code: 'KYC_NOT_CONFIGURED' });
    }
    const url = `${String(config.base_url).replace(/\/+$/, '')}${config.endpoints[endpointKey]}`;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const payload = { ...body };
    if (config.auth_mode === 'header') {
      headers[config.auth_field || 'Authorization'] = `${config.auth_prefix ? `${config.auth_prefix} ` : ''}${config.api_key}`;
    } else {
      payload[config.auth_field || 'key'] = config.api_key;
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Number(config.timeout_ms) || 20000),
      });
    } catch (error) {
      throw new KycProviderError('Could not reach the verification service. Please try again.', {
        status: 503,
        code: 'KYC_PROVIDER_UNAVAILABLE',
        retryable: true,
      });
    }

    const parsed = await response.json().catch(() => ({}));
    if (!response.ok || !isSuccessful(parsed)) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new KycProviderError(readMessage(parsed), {
        status: retryable ? 503 : 422,
        code: retryable ? 'KYC_PROVIDER_UNAVAILABLE' : 'KYC_VERIFICATION_FAILED',
        retryable,
      });
    }
    return parsed;
  };

  return {
    environment: config.environment,

    /// Sends an OTP to the mobile linked with the Aadhaar. Returns the
    /// provider's request id, needed to submit the OTP.
    async startAadhaarOtp(aadhaarNumber) {
      if (isMock) return { requestId: `mock-otp-${Date.now()}` };
      const body = await call('aadhaar_generate_otp', { id_number: aadhaarNumber });
      const requestId = String(pick(body, ['request_id', 'client_id', 'reference_id', 'data.request_id', 'data.client_id', 'data.reference_id']) || '');
      if (!requestId) throw new KycProviderError('Verification service did not return a request id');
      return { requestId };
    },

    async submitAadhaarOtp(requestId, otp) {
      if (isMock) {
        if (String(otp) !== MOCK_AADHAAR_OTP) {
          throw new KycProviderError('Incorrect OTP', { status: 422, code: 'KYC_VERIFICATION_FAILED' });
        }
        return mockIdentity('aadhaar');
      }
      const body = await call('aadhaar_submit_otp', { request_id: requestId, client_id: requestId, otp: String(otp) });
      return { ...normalizeIdentity(body), providerRef: normalizeIdentity(body).providerRef || requestId };
    },

    /// PAN, driving licence and voter ID: one call, verified or not.
    async verifyDocument(documentType, number, extra = {}) {
      if (isMock) return mockIdentity(documentType);
      const body = await call(documentType, {
        id_number: number,
        ...(extra.dob ? { dob: extra.dob } : {}),
      });
      return normalizeIdentity(body);
    },
  };
};
