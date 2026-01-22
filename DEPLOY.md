# Інструкція по деплою на Netlify

## Варіант 1: Через Netlify Dashboard (рекомендовано)

1. Зайдіть на https://app.netlify.com та зареєструйтесь/увійдіть
2. Натисніть "Add new site" → "Import an existing project"
3. Підключіть ваш GitHub/GitLab/Bitbucket репозиторій
4. Налаштування будуть автоматично підхоплені з `netlify.toml`, але перевірте:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `dist` (відносно base directory, тобто `frontend/dist`)
5. Натисніть "Deploy site"

## ⚠️ Якщо виникає помилка 404 "Page not found"

Якщо після деплою ви бачите помилку 404, зробіть наступне:

1. **Перевірте, що файл `_redirects` копіюється в `dist`**:
   - Vite автоматично копіює файли з `frontend/public/` в `frontend/dist/`
   - Файл `frontend/public/_redirects` має містити: `/*    /index.html   200`

2. **Перебудуйте проект на Netlify**:
   - Зайдіть в Netlify Dashboard → ваш сайт → "Deploys"
   - Натисніть "Trigger deploy" → "Clear cache and deploy site"

3. **Перевірте налаштування в Netlify Dashboard**:
   - Site settings → Build & deploy → Build settings
   - Переконайтеся, що:
     - Base directory: `frontend`
     - Build command: `npm run build`
     - Publish directory: `dist`

4. **Перевірте логи збірки**:
   - В розділі "Deploys" натисніть на останній деплой
   - Перевірте, чи файл `_redirects` з'являється в логах збірки

## Варіант 2: Через Netlify CLI

### Встановлення Netlify CLI:
```bash
npm install -g netlify-cli
```

### Деплой:
```bash
# Перейдіть в папку frontend
cd frontend

# Встановіть залежності (якщо ще не встановлені)
npm install

# Збудуйте проект
npm run build

# Поверніться в корінь проекту
cd ..

# Увійдіть в Netlify (перший раз)
netlify login

# Ініціалізуйте сайт
netlify init

# Або задеплойте одразу
netlify deploy --prod
```

## Варіант 3: Drag & Drop

1. Перейдіть в папку `frontend`
2. Запустіть `npm install` та `npm run build`
3. Зайдіть на https://app.netlify.com/drop
4. Перетягніть папку `frontend/dist` на сторінку

## Налаштування

Файл `netlify.toml` вже налаштований для:
- Базової директорії: `frontend`
- Команди збірки: `npm run build`
- Директорії публікації: `frontend/dist`
- SPA роутингу (всі маршрути перенаправляються на index.html)

## Змінні середовища (якщо потрібні)

Якщо ваш додаток потребує змінних середовища:
1. Зайдіть в Netlify Dashboard → Site settings → Environment variables
2. Додайте необхідні змінні

