/**
 * [NiceMatrix] i18n phrases for the self-service account-deletion flow.
 *
 * Structure mirrors profile-phrases.ts:
 *   - Top-level namespaces are Logto locale codes.
 *   - `account_center.deletion.*` keys are merged into the upstream
 *     translation bundle via `i18next.addResourceBundle` so we don't need to
 *     patch the shipped phrase files.
 */
import i18next from 'i18next';

const phrases = {
  'zh-CN': {
    account_center: {
      deletion: {
        section_title: '注销账户',
        section_description:
          '注销后将移除您在 NiceMatrix 的所有个人数据。注销申请提交后有 15 天冷静期，期间可随时取消。',
        danger_title: '危险操作',
        danger_description: '此操作不可逆，请确认后再继续。',
        delete_button: '申请注销账户',
        reason_label: '注销原因（可选）',
        reason_placeholder: '请告诉我们您注销的原因，帮助我们改进产品',
        submit: '提交申请',
        cancel: '取消',

        step_confirm_title: '确认注销',
        step_confirm_warning:
          '提交后我们会向您的邮箱发送一封确认邮件。只有在 24 小时内点击邮件里的链接，您的注销申请才会正式生效。',
        step_second_confirm_title: '最后确认',
        step_second_confirm_warning:
          '点击"确认注销"后申请会发起，并进入 15 天冷静期。您可在冷静期内随时取消。超过冷静期后账户将被永久删除。',
        confirm_final: '确认注销',

        awaiting_confirmation_banner_title: '请查收确认邮件',
        awaiting_confirmation_banner_description:
          '我们已向您发送一封注销确认邮件，请在 24 小时内点击其中的链接完成注销申请。',

        pending_banner_title: '您的账户将于 {{date}} 被注销',
        pending_banner_description:
          '您仍在 15 天冷静期内。账户功能可正常使用，您可随时取消本次注销申请。',
        cancel_request: '取消注销申请',
        cancel_success: '已取消注销申请',
        create_success: '注销申请已提交，请查收确认邮件',
        confirm_success: '注销申请已确认，账户将于 {{date}} 被删除',

        error_already_exists: '您已经有一个未完成的注销申请',
        error_token_expired: '确认链接已过期，请重新发起注销申请',
        error_token_invalid: '确认链接无效',
        error_unknown: '操作失败，请稍后重试',
      },
    },
  },
  'zh-HK': {
    account_center: {
      deletion: {
        section_title: '註銷帳戶',
        section_description:
          '註銷後會刪除您在 NiceMatrix 的所有個人資料。註銷申請提交後有 15 天冷靜期，期間可隨時取消。',
        danger_title: '危險操作',
        danger_description: '此操作無法復原，請確認後再繼續。',
        delete_button: '申請註銷帳戶',
        reason_label: '註銷原因（選填）',
        reason_placeholder: '請告訴我們您註銷的原因，協助我們改善產品',
        submit: '提交申請',
        cancel: '取消',

        step_confirm_title: '確認註銷',
        step_confirm_warning:
          '提交後我們會寄一封確認郵件到您的信箱。只有在 24 小時內點擊郵件中的連結，您的註銷申請才會正式生效。',
        step_second_confirm_title: '最後確認',
        step_second_confirm_warning:
          '點擊「確認註銷」後申請會發起，並進入 15 天冷靜期。您可以在冷靜期內隨時取消；超過冷靜期後帳戶將被永久刪除。',
        confirm_final: '確認註銷',

        awaiting_confirmation_banner_title: '請查收確認郵件',
        awaiting_confirmation_banner_description:
          '我們已寄出一封註銷確認郵件，請在 24 小時內點擊其中連結以完成註銷申請。',

        pending_banner_title: '您的帳戶將於 {{date}} 被註銷',
        pending_banner_description:
          '您仍在 15 天冷靜期內。帳戶功能可正常使用，您可以隨時取消本次註銷申請。',
        cancel_request: '取消註銷申請',
        cancel_success: '已取消註銷申請',
        create_success: '註銷申請已提交，請查收確認郵件',
        confirm_success: '註銷申請已確認，帳戶將於 {{date}} 被刪除',

        error_already_exists: '您已經有一個未完成的註銷申請',
        error_token_expired: '確認連結已過期，請重新發起註銷申請',
        error_token_invalid: '確認連結無效',
        error_unknown: '操作失敗，請稍後再試',
      },
    },
  },
  'zh-TW': {
    account_center: {
      deletion: {
        section_title: '註銷帳戶',
        section_description:
          '註銷後會刪除您在 NiceMatrix 的所有個人資料。註銷申請提交後有 15 天冷靜期，期間可隨時取消。',
        danger_title: '危險操作',
        danger_description: '此操作無法復原，請確認後再繼續。',
        delete_button: '申請註銷帳戶',
        reason_label: '註銷原因（選填）',
        reason_placeholder: '請告訴我們您註銷的原因，協助我們改善產品',
        submit: '提交申請',
        cancel: '取消',

        step_confirm_title: '確認註銷',
        step_confirm_warning:
          '提交後我們會寄一封確認郵件到您的信箱。只有在 24 小時內點擊郵件中的連結，您的註銷申請才會正式生效。',
        step_second_confirm_title: '最後確認',
        step_second_confirm_warning:
          '點擊「確認註銷」後申請會發起，並進入 15 天冷靜期。您可以在冷靜期內隨時取消；超過冷靜期後帳戶將被永久刪除。',
        confirm_final: '確認註銷',

        awaiting_confirmation_banner_title: '請查收確認郵件',
        awaiting_confirmation_banner_description:
          '我們已寄出一封註銷確認郵件，請在 24 小時內點擊其中連結以完成註銷申請。',

        pending_banner_title: '您的帳戶將於 {{date}} 被註銷',
        pending_banner_description:
          '您仍在 15 天冷靜期內。帳戶功能可正常使用，您可以隨時取消本次註銷申請。',
        cancel_request: '取消註銷申請',
        cancel_success: '已取消註銷申請',
        create_success: '註銷申請已提交，請查收確認郵件',
        confirm_success: '註銷申請已確認，帳戶將於 {{date}} 被刪除',

        error_already_exists: '您已經有一個未完成的註銷申請',
        error_token_expired: '確認連結已過期，請重新發起註銷申請',
        error_token_invalid: '確認連結無效',
        error_unknown: '操作失敗，請稍後再試',
      },
    },
  },
  en: {
    account_center: {
      deletion: {
        section_title: 'Delete account',
        section_description:
          'Deleting your account removes all your personal data from NiceMatrix. Requests enter a 15-day grace window and can be cancelled any time.',
        danger_title: 'Danger zone',
        danger_description: 'This action is irreversible. Please confirm before continuing.',
        delete_button: 'Request account deletion',
        reason_label: 'Reason (optional)',
        reason_placeholder: 'Tell us why you are leaving so we can improve',
        submit: 'Submit request',
        cancel: 'Cancel',

        step_confirm_title: 'Confirm deletion',
        step_confirm_warning:
          'We will email you a confirmation link. Your deletion request only takes effect after you click the link within 24 hours.',
        step_second_confirm_title: 'Final confirmation',
        step_second_confirm_warning:
          'Clicking "Confirm deletion" submits the request and starts a 15-day grace window. You can cancel any time before it ends; afterwards the account is permanently deleted.',
        confirm_final: 'Confirm deletion',

        awaiting_confirmation_banner_title: 'Check your email',
        awaiting_confirmation_banner_description:
          'We sent a confirmation email. Click the link within 24 hours to finalize your deletion request.',

        pending_banner_title: 'Your account will be deleted on {{date}}',
        pending_banner_description:
          'You are in the 15-day grace window. Your account still works normally, and you can cancel the request at any time.',
        cancel_request: 'Cancel deletion request',
        cancel_success: 'Deletion request cancelled',
        create_success: 'Deletion request submitted. Please check your email.',
        confirm_success: 'Deletion confirmed. Your account will be deleted on {{date}}.',

        error_already_exists: 'You already have an open deletion request',
        error_token_expired: 'Confirmation link expired. Please submit a new request.',
        error_token_invalid: 'Invalid confirmation link.',
        error_unknown: 'Something went wrong. Please try again.',
      },
    },
  },
} as const;

let injected = false;

const writeBundles = () => {
  for (const [language, bundle] of Object.entries(phrases)) {
    try {
      i18next.addResourceBundle(
        language,
        'translation',
        bundle as Record<string, unknown>,
        true,
        false
      );
    } catch {
      // i18next not yet initialized — will retry on init event.
    }
  }
};

export const injectDeletionPhrases = () => {
  if (injected) {
    return;
  }

  if (!i18next.isInitialized) {
    i18next.on('initialized', writeBundles);
    i18next.on('languageChanged', writeBundles);
    injected = true;
    return;
  }

  injected = true;
  writeBundles();
};
