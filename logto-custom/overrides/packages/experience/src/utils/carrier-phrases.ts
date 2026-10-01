/**
 * [NiceMatrix] Carrier one-tap login — user-facing messages on the hosted
 * sign-in page (toasts after the Broker sent the user back). NiceMatrix-owned,
 * so no upstream phrase file is overridden; resolved from the active i18next
 * language with English as the last resort (all three NiceMatrix languages are
 * complete). Provider details are never shown (plan §2.2-4).
 */
import i18next from 'i18next';

type Phrases = {
  failed: string;
  number_mismatch: string;
  locked: string;
  network: string;
  unavailable: string;
  expired: string;
  retry_limit: string;
};

const phrases: Record<'en' | 'zh-CN' | 'zh-TW', Phrases> = {
  en: {
    failed: 'Phone number sign-in did not complete. Please choose another sign-in method.',
    number_mismatch: 'The phone number digits did not match. Try again or use another method.',
    locked: 'Too many wrong attempts for this number. Please use another sign-in method.',
    network: 'Phone number sign-in needs mobile data. Turn off Wi-Fi or use another method.',
    unavailable: 'Phone number sign-in is temporarily unavailable. Please use another method.',
    expired: 'Phone number sign-in timed out. Please try again.',
    retry_limit: 'Phone number sign-in was tried too many times. Please use another method.',
  },
  'zh-CN': {
    failed: '本机号码登录未完成，请选择其他登录方式。',
    number_mismatch: '号码校验未通过，可重试或使用其他登录方式。',
    locked: '该号码校验错误次数过多，请使用其他登录方式。',
    network: '本机号码登录需使用移动数据，请关闭 Wi-Fi 或使用其他登录方式。',
    unavailable: '本机号码登录暂时不可用，请使用其他登录方式。',
    expired: '本机号码登录已超时，请重试。',
    retry_limit: '本机号码登录尝试次数过多，请使用其他登录方式。',
  },
  'zh-TW': {
    failed: '本機號碼登入未完成，請選擇其他登入方式。',
    number_mismatch: '號碼驗證未通過，可重試或使用其他登入方式。',
    locked: '此號碼驗證錯誤次數過多，請使用其他登入方式。',
    network: '本機號碼登入需使用行動數據，請關閉 Wi-Fi 或使用其他登入方式。',
    unavailable: '本機號碼登入暫時無法使用，請使用其他登入方式。',
    expired: '本機號碼登入已逾時，請重試。',
    retry_limit: '本機號碼登入嘗試次數過多，請使用其他登入方式。',
  },
};

const tableFor = (language: string | undefined): Phrases => {
  const lng = (language ?? '').toLowerCase();

  if (lng.startsWith('zh-tw') || lng.startsWith('zh-hk') || lng.startsWith('zh-hant') || lng.startsWith('zh-mo')) {
    return phrases['zh-TW'];
  }

  if (lng.startsWith('zh')) {
    return phrases['zh-CN'];
  }

  return phrases.en;
};

const keyForClass = (failureClass: string): keyof Phrases => {
  switch (failureClass) {
    case 'number_mismatch': {
      return 'number_mismatch';
    }

    case 'provider_locked': {
      return 'locked';
    }

    case 'network_unsupported': {
      return 'network';
    }

    case 'provider_timeout':
    case 'provider_unavailable':
    case 'provider_config_error':
    case 'not_supported':
    case 'rate_limited': {
      return 'unavailable';
    }

    case 'attempt_expired':
    case 'token_invalid_or_expired': {
      return 'expired';
    }

    default: {
      return 'failed';
    }
  }
};

export const carrierFailureMessage = (failureClass: string): string =>
  tableFor(i18next.language)[keyForClass(failureClass)];

export const carrierRetryLimitMessage = (): string => tableFor(i18next.language).retry_limit;
