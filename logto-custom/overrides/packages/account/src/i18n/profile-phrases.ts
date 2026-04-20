/**
 * [NiceMatrix] Inject ProfileSection translations into the i18next instance
 * without touching the @logto/phrases-experience package. Invoked once from
 * ProfileSection mount so the keys are available before first render.
 */
import i18next from 'i18next';

const phrases = {
  'zh-CN': {
    profile_section: {
      page_title: '账户中心',
      page_description: '在此管理你的账户资料和设置',
      title: '基本资料',
      description: '管理你的头像、姓名、生日、性别和地址信息。',
      avatar: '头像',
      avatar_hint: '支持 PNG / JPG / WebP / GIF',
      avatar_supported_formats: '支持 PNG / JPG / WebP / GIF',
      change_avatar: '更换头像',
      upload_avatar: '更换头像',
      remove_avatar: '移除头像',
      remove_avatar_confirm_title: '移除头像',
      remove_avatar_confirm_body: '确定要移除当前头像吗？此操作会立即生效，无法撤销。',
      remove_avatar_confirm_ok: '移除',
      removed: '头像已移除',
      display_name: '显示名',
      family_name: '姓',
      given_name: '名',
      nickname: '昵称',
      birthdate: '生日',
      gender: '性别',
      address: '地址',
      address_hint: '用于收货或身份验证',
      not_set: '未设置',
      change: '修改',
      save: '保存',
      cancel: '取消',
      gender_female: '女',
      gender_male: '男',
      gender_prefer_not_to_say: '不愿透露',
      upload_too_large: '图片超过允许的大小',
      upload_bad_type: '仅支持 PNG / JPG / WebP 格式',
      upload_failed: '上传失败，请稍后再试',
      save_failed: '保存失败，请稍后再试',
      saved: '已保存',
    },
  },
  'zh-HK': {
    profile_section: {
      page_title: '帳戶中心',
      page_description: '在此管理你的帳戶資料和設定',
      title: '基本資料',
      description: '管理你的頭像、姓名、生日、性別和地址資料。',
      avatar: '頭像',
      avatar_hint: '支援 PNG / JPG / WebP / GIF',
      avatar_supported_formats: '支援 PNG / JPG / WebP / GIF',
      change_avatar: '更換頭像',
      upload_avatar: '更換頭像',
      remove_avatar: '移除頭像',
      remove_avatar_confirm_title: '移除頭像',
      remove_avatar_confirm_body: '確定要移除目前的頭像嗎？此操作立即生效，無法復原。',
      remove_avatar_confirm_ok: '移除',
      removed: '頭像已移除',
      display_name: '顯示名稱',
      family_name: '姓',
      given_name: '名',
      nickname: '暱稱',
      birthdate: '生日',
      gender: '性別',
      address: '地址',
      address_hint: '用於收件或身份驗證',
      not_set: '未設定',
      change: '修改',
      save: '儲存',
      cancel: '取消',
      gender_female: '女',
      gender_male: '男',
      gender_prefer_not_to_say: '不願透露',
      upload_too_large: '圖片超過允許大小',
      upload_bad_type: '只支援 PNG / JPG / WebP 格式',
      upload_failed: '上傳失敗，請稍後再試',
      save_failed: '儲存失敗，請稍後再試',
      saved: '已儲存',
    },
  },
  'zh-TW': {
    profile_section: {
      page_title: '帳戶中心',
      page_description: '在此管理你的帳戶資料和設定',
      title: '基本資料',
      description: '管理你的頭像、姓名、生日、性別和地址資料。',
      avatar: '頭像',
      avatar_hint: '支援 PNG / JPG / WebP / GIF',
      avatar_supported_formats: '支援 PNG / JPG / WebP / GIF',
      change_avatar: '更換頭像',
      upload_avatar: '更換頭像',
      remove_avatar: '移除頭像',
      remove_avatar_confirm_title: '移除頭像',
      remove_avatar_confirm_body: '確定要移除目前的頭像嗎？此操作立即生效，無法復原。',
      remove_avatar_confirm_ok: '移除',
      removed: '頭像已移除',
      display_name: '顯示名稱',
      family_name: '姓',
      given_name: '名',
      nickname: '暱稱',
      birthdate: '生日',
      gender: '性別',
      address: '地址',
      address_hint: '用於收件或身份驗證',
      not_set: '未設定',
      change: '修改',
      save: '儲存',
      cancel: '取消',
      gender_female: '女',
      gender_male: '男',
      gender_prefer_not_to_say: '不願透露',
      upload_too_large: '圖片超過允許大小',
      upload_bad_type: '只支援 PNG / JPG / WebP 格式',
      upload_failed: '上傳失敗，請稍後再試',
      save_failed: '儲存失敗，請稍後再試',
      saved: '已儲存',
    },
  },
  en: {
    profile_section: {
      page_title: 'Account Center',
      page_description: 'Change your account profile and settings here',
      title: 'Profile',
      description: 'Manage your avatar, name, birthdate, gender and address.',
      avatar: 'Avatar',
      avatar_hint: 'Supported: PNG / JPG / WebP / GIF',
      avatar_supported_formats: 'Supported: PNG / JPG / WebP / GIF',
      change_avatar: 'Change avatar',
      upload_avatar: 'Change avatar',
      remove_avatar: 'Remove avatar',
      remove_avatar_confirm_title: 'Remove avatar',
      remove_avatar_confirm_body: 'Remove the current avatar? This takes effect immediately and cannot be undone.',
      remove_avatar_confirm_ok: 'Remove',
      removed: 'Avatar removed',
      display_name: 'Display name',
      family_name: 'Family name',
      given_name: 'Given name',
      nickname: 'Nickname',
      birthdate: 'Birthdate',
      gender: 'Gender',
      address: 'Address',
      address_hint: 'Used for delivery or identity verification',
      not_set: 'Not set',
      change: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      gender_female: 'Female',
      gender_male: 'Male',
      gender_prefer_not_to_say: 'Prefer not to say',
      upload_too_large: 'Image exceeds the allowed size',
      upload_bad_type: 'Only PNG / JPG / WebP images are supported',
      upload_failed: 'Upload failed, please try again',
      save_failed: 'Save failed, please try again',
      saved: 'Saved',
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
      // i18next not yet initialized — will retry on the next call.
    }
  }
};

export const injectProfilePhrases = () => {
  if (injected) {
    return;
  }

  // If i18next has not been initialized yet (modules are loaded before
  // App.tsx runs `initI18n`), defer the write until after init completes.
  // We still set `injected` early so repeat calls are no-ops.
  if (!i18next.isInitialized) {
    i18next.on('initialized', writeBundles);
    // Also on languageChanged — fallback for when init races with first render.
    i18next.on('languageChanged', writeBundles);
    injected = true;
    return;
  }

  injected = true;
  writeBundles();
};
