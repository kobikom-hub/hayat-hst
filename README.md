# Hayat Hastanesi Node.js Proxy

Hayat Hastanesi randevu sistemi icin tek endpointli bir Node.js proxy servisidir. AI agent sadece business action adlarini bilir; `PHPSESSID`, `captcha`, `set_variables` ve gercek hastane endpointleri proxy tarafinda yonetilir.

## Kurulum

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## Calistirma

```bash
npm start
```

Varsayilan port `3000`'dir.

## Ortam Degiskenleri

- `PORT`: Express sunucusunun portu
- `BASE_URL`: Gercek hastane sisteminin base URL'i
- `PROXY_TOKEN`: Tum isteklere zorunlu `X-Proxy-Token`
- `SESSION_TTL_MS`: Conversation session omru
- `CAPTCHA_MAX_ATTEMPTS`: Captcha hata durumunda retry sayisi

## API

Tek endpoint kullanilir:

```http
POST /
X-Proxy-Token: CHANGE_THIS_TOKEN
Content-Type: application/json
```

### `get_departments`

```json
{
  "action": "get_departments",
  "conversation_id": "call_123456",
  "hospital_id": 2
}
```

### `get_doctors`

```json
{
  "action": "get_doctors",
  "conversation_id": "call_123456",
  "department_id": 15
}
```

### `get_days`

```json
{
  "action": "get_days",
  "conversation_id": "call_123456"
}
```

### `get_appointment_time`

```json
{
  "action": "get_appointment_time",
  "conversation_id": "call_123456",
  "doctor_id": 120,
  "dept_id": 15,
  "day": "2026-05-15"
}
```

### `set_appointment_time`

```json
{
  "action": "set_appointment_time",
  "conversation_id": "call_123456",
  "aop_id": 12345,
  "app_type": 1
}
```

### `get_patient_info`

```json
{
  "action": "get_patient_info",
  "conversation_id": "call_123456",
  "identity_no": "11111111111",
  "father_name": "AHMET",
  "birth_date": "1989-05-10"
}
```

### `create_patient`

```json
{
  "action": "create_patient",
  "conversation_id": "call_123456",
  "identity_no": "11111111111",
  "name": "YASIN",
  "surname": "BARAN",
  "gender": "ERKEK",
  "birth_date": "10.05.1989",
  "father_name": "BEKIR",
  "mother_name": "FATMA",
  "phone": "5551112233",
  "city_id": 16,
  "county_id": null,
  "association_id": 2
}
```

### `get_counties`

```json
{
  "action": "get_counties",
  "conversation_id": "call_123456",
  "city_id": 16
}
```

### `send_sms`

```json
{
  "action": "send_sms",
  "conversation_id": "call_123456",
  "pn_id": 987
}
```

### `check_verification_code`

```json
{
  "action": "check_verification_code",
  "conversation_id": "call_123456",
  "verification_code": "123456"
}
```

### `get_appointment_approve`

```json
{
  "action": "get_appointment_approve",
  "conversation_id": "call_123456"
}
```

### `approve_appointment`

```json
{
  "action": "approve_appointment",
  "conversation_id": "call_123456"
}
```

## Curl Ornegi

```bash
curl -X POST http://localhost:3000/ \
  -H 'Content-Type: application/json' \
  -H 'X-Proxy-Token: CHANGE_THIS_TOKEN' \
  -d '{
    "action": "get_departments",
    "conversation_id": "call_123456",
    "hospital_id": 2
  }'
```

## Notlar

- Ayni `conversation_id` boyunca ayni Playwright session ve `PHPSESSID` kullanilir.
- Proxy captcha gorselini kendi indirir ve `tesseract.js` ile cozmeyi dener.
- Proxy HTML veya JSON cevaplarini olabildigince structured JSON'a cevirir.
- `appointment_approve.php` icin doktor, brans, tarih, saat ve merkez bilgileri parse edilmeye calisilir.
