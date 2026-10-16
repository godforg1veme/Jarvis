const { response, button } = require('./jobTelegramViews');
const TEXT = Object.freeze({
  PREPARATION_DELAYED: 'Не удалось подготовить картинку CAPTCHA HH. Проверка повторится автоматически с паузой. Прогресс поиска сохранён.',
  PHOTO_UNKNOWN: 'Не удалось подтвердить доставку картинки CAPTCHA HH. Повторно она не отправляется. Если фото не пришло, нажми «Обновить картинку».',
  ANSWER_UNKNOWN: 'Не удалось подтвердить результат ответа на CAPTCHA HH. Ответ повторно не отправляется. Нажми «Обновить картинку», чтобы продолжить проверку.',
  PHOTO_FAILED: 'Telegram не принял картинку CAPTCHA HH. Нажми «Обновить картинку», чтобы запросить новую. Прогресс поиска сохранён.',
  REFRESH_REQUIRED: 'Картинка CAPTCHA HH устарела, уже использована или недоступна после сбоя браузера. Нажми «Обновить картинку».',
  NO_CHALLENGE: 'Сейчас активной CAPTCHA HH нет. Если поиск не возобновился, открой «Поиск работы» и проверь его состояние.',
});
function captchaNoticeView(code) {
  if (!Object.hasOwn(TEXT, code)) return null;
  return response(TEXT[code], [[button('Обновить картинку', 'captcha_refresh')]]);
}
module.exports = { captchaNoticeView };
