import type { Locale } from '../task-engine/index.ts';
export function securityCopy(locale: Locale, role: 'owner' | 'support' = 'owner') {
  const t = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  return {
    title: t('账号与登录', 'Account & sign-ins'), intro: role === 'support' ? t('管理你自己的密码、登录及由你开启的孩子模式。','Manage your password, sign-ins and child access you started.') : t('管理创建者密码和家庭的登录状态。', 'Manage the creator password and family sign-ins.'),
    sessions: t('当前有效登录', 'Current sign-ins'), parents: t('家长登录', 'Parent sign-ins'), children: t('孩子模式', 'Child access'),
    browsers: t('浏览器', 'Browser'), apps: t('App', 'App'), counts: t('这里统计有效登录，不代表设备数量；同一设备可能有多个登录。', 'These are active sign-ins, not device counts. One device may have more than one.'),
    password: t('修改家长密码', 'Change parent password'), signout: t('退出全部登录', 'Sign out everywhere'),
    consequence: role === 'support' ? t('你的浏览器、App 和由你开启的孩子模式会退出，包括这里。其他家长不受影响。已保存记录保留；离线设备联网后才能获知。','Your browsers, apps and child sessions you started will sign out, including here. Other parents are unaffected. Saved records remain; offline devices learn about it when they reconnect.') : t('所有浏览器、App 和孩子模式都需要重新登录，包括这里。已保存的家庭记录保留；离线设备联网后才能获知退出状态。', 'Every browser, app and child session will need to sign in again, including here. Saved family records remain. Offline devices learn about sign-out when they reconnect.'),
    current: t('当前家长密码', 'Current parent password'), next: t('新密码', 'New password'), repeat: t('再次输入新密码', 'Repeat new password'),
    hint: t('至少 15 个字符，可以使用容易记住的长句；无需凑齐特定符号。', 'Use at least 15 characters. A memorable passphrase works; no special mix of symbols is required.'),
    mismatch: t('两次新密码还不一致。', 'The new passwords do not match yet.'),
    acknowledge: t('我已了解全部登录都会退出，已有记录会保留。', 'I understand all sign-ins will end and saved records will remain.'),
    save: t('更新密码并退出', 'Update password & sign out'), confirmSignout: t('确认退出全部登录', 'Confirm sign-out everywhere'),
    busy: t('正在确认…', 'Confirming…'), loading: t('正在读取登录状态…', 'Loading sign-ins…'), retry: t('重新读取', 'Reload'), cancel: t('取消', 'Cancel'), signin: t('回到家长登录', 'Return to parent sign-in'),
    changed: t('密码已更新。请使用新密码重新登录。', 'Your password has changed. Sign in with your new password.'),
    signedOut: t('全部登录已退出。再次使用家庭空间时请登录。', 'All sign-ins have ended. Sign in again to use your family space.'),
    uncertain: t('尚未确认操作结果。请重新登录；如果刚修改了密码，请先使用新密码。', 'The result could not be confirmed. Sign in again; if you changed your password, try the new password first.'),
    ended: t('当前登录已结束，请重新验证家长身份。', 'This sign-in has ended. Sign in again as a parent.'),
    error: (code: string) => ({ PASSWORD_REJECTED: t('当前密码不正确，请重新输入。', 'The current password is incorrect. Enter it again.'), ACCOUNT_LOCKED: t('密码尝试过于频繁，请在十五分钟后再试。', 'Too many password attempts. Try again in fifteen minutes.'), PASSWORD_UNCHANGED: t('请使用与当前密码不同的新密码。', 'Choose a password different from your current password.'), INVALID_REQUEST: t('请检查密码长度和确认选项。', 'Check the password length and confirmation.'), LOAD_FAILED: t('暂时无法读取，请连接家庭服务后重试。', 'Unable to load. Reconnect to the family service and retry.') }[code] ?? t('暂时无法完成，请重新登录后再试。', 'Unable to continue. Sign in again and retry.')),
  };
}
