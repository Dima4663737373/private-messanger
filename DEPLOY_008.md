# Інструкція по деплою контракту версії 008

## Підготовка

Контракт вже скомпільовано. Файли знаходяться в `build/`.

## Варіант 1: Через Leo CLI (інтерактивно)

1. Відкрийте термінал в корені проекту
2. Виконайте команду:
```bash
leo deploy --network testnet --private-key APrivateKey1zkp3CAcpd4QNiUhznYhou5A2wjiBgvfrbTR3i81XzZVqewa --endpoint https://api.explorer.provable.com/v1 --broadcast
```
3. Підтвердіть деплой, ввівши `y` коли з'явиться запит

## Варіант 2: Через snarkos CLI

1. Переконайтеся, що у вас є record з credits для оплати fee
2. Виконайте команду:
```bash
snarkos developer deploy priv_messenger_leotest_008.aleo \
  --private-key APrivateKey1zkp3CAcpd4QNiUhznYhou5A2wjiBgvfrbTR3i81XzZVqewa \
  --endpoint https://api.explorer.aleo.org/v1 \
  --path build \
  --broadcast https://api.explorer.aleo.org/v1/testnet3/transaction/broadcast \
  --priority-fee 0 \
  --record "YOUR_RECORD_PLAINTEXT"
```

## Після деплою

Після успішного деплою оновіть `frontend/src/deployed_program.ts`:
```typescript
export const PROGRAM_ID = "priv_messenger_leotest_008.aleo";
```

## Нові функції в версії 008

- `update_contact_name` - зміна назви контакта через блокчейн
- `delete_chat` - видалення чату через блокчейн  
- `restore_chat` - відновлення видаленого чату

Всі функції працюють з комісією 0.05 ALEO.
