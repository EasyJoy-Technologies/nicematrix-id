/**
 * [NiceMatrix] Inject ProfileSection translations into the i18next instance
 * without touching the @logto/phrases-experience package. Invoked once from
 * ProfileSection mount so the keys are available before first render.
 */
import i18next from 'i18next';

const phrases = {
  'zh-CN': {
    profile_section: {
      title: '基本资料',
      description: '管理你的头像、姓名、生日、性别和地址信息。',
      avatar: '头像',
      avatar_hint: '推荐 512×512 以内的 PNG / JPG / WebP 图片',
      upload_avatar: '更换头像',
      remove_avatar: '移除头像',
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
      title: '基本資料',
      description: '管理你的頭像、姓名、生日、性別和地址資料。',
      avatar: '頭像',
      avatar_hint: '建議 512×512 以內的 PNG / JPG / WebP 圖片',
      upload_avatar: '更換頭像',
      remove_avatar: '移除頭像',
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
      title: '基本資料',
      description: '管理你的頭像、姓名、生日、性別和地址資料。',
      avatar: '頭像',
      avatar_hint: '建議 512×512 以內的 PNG / JPG / WebP 圖片',
      upload_avatar: '更換頭像',
      remove_avatar: '移除頭像',
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
      title: 'Profile',
      description: 'Manage your avatar, name, birthdate, gender and address.',
      avatar: 'Avatar',
      avatar_hint: 'PNG / JPG / WebP, recommended 512×512 or smaller',
      upload_avatar: 'Change avatar',
      remove_avatar: 'Remove avatar',
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
