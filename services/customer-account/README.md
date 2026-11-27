# 로켓보안 고객 계정

Google 계정으로 로그인한 고객이 원화 주문을 만들고 토스페이먼츠 결제 결과를 확인하는 앱입니다. Vercel 프로젝트의 루트 디렉터리는 `services/customer-account`이며, 주문과 세션은 이 프로젝트 전용 비공개 Blob 저장소를 사용합니다.

## 상점 연결

1. Google Cloud에서 웹 애플리케이션용 OAuth 클라이언트를 만듭니다. 승인된 리디렉션 URI에 `https://rocket-security-account.vercel.app/api/auth?action=callback`을 정확히 등록합니다. 테스트 상태라면 로그인에 쓸 계정을 테스트 사용자에 추가합니다.
2. Vercel 프로젝트 `rocket-security-account`의 Production 환경 변수에 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 저장합니다.
3. 토스페이먼츠 개발자센터의 **API 개별 연동 키**에서 같은 상점의 테스트 클라이언트 키와 시크릿 키를 각각 `TOSS_CLIENT_KEY`와 `TOSS_SECRET_KEY`에 저장합니다. 테스트 기본 단가는 도메인당 100,000원입니다. 상점 계약 후 실결제로 전환할 때는 같은 상점의 라이브 키 두 개와 판매 단가 `ROCKET_UNIT_PRICE_KRW`를 함께 설정합니다.
4. Production을 다시 배포한 뒤 테스트 계정으로 로그인하고 결제창에서 테스트 결제를 완료합니다. 주문 내역에서 해당 거래의 금액과 상태를 확인합니다. 테스트·라이브 전환 전에는 기존 모드의 미확정 거래를 먼저 정산합니다.

`ROCKET_ORIGIN`은 실제 고객 계정 사이트의 HTTPS 원점으로 설정합니다. 등록 도메인이 바뀌면 Google 리디렉션 URI와 홈페이지의 고객 계정 링크도 맞춰 변경합니다. `BLOB_READ_WRITE_TOKEN`은 비공개 Vercel Blob 저장소를 프로젝트에 연결하면 설정됩니다. 상점 키와 OAuth 비밀값은 서버 환경에만 보관합니다.

## 확인

계정 상태는 `GET /api/account`에서 연결 준비 여부만 제공합니다. `npm test`는 모의 Google·결제기관·저장소를 사용합니다. 운영 상점에서 결제 시험을 할 때는 실제 청구 금액을 반드시 확인합니다.
