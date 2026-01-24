# Ghost Frontend Setup

## Проблеми виправлено:

1. ✅ **Gemini API Key** - додано обробку відсутності ключа, додаток не падає
2. ✅ **PostCSS конфігурація** - видалено, оскільки Tailwind використовується через CDN
3. ✅ **Обробка помилок** - додано graceful fallback для Gemini API

## Налаштування Gemini API (опціонально):

1. Створіть файл `.env` в папці `frontend/`:
```
VITE_GEMINI_API_KEY=your_api_key_here
```

2. Отримайте API ключ: https://aistudio.google.com/app/apikey

3. Перезапустіть сервер розробки

**Примітка:** Без API ключа чат-функції будуть недоступні, але додаток працюватиме.

## Помилки з window.ethereum:

Помилки з `window.ethereum` виникають через конфлікти між розширеннями браузера (Nightly Wallet, Razor Wallet). Вони не впливають на роботу додатку і можуть бути проігноровані.

## Запуск:

```bash
cd frontend
npm install
npm run dev
```

Сайт буде доступний на http://localhost:8082/ (або іншому вільному порту)
