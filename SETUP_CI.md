# iOS CI/CD Setup Guide

GitHub Actions로 IPA를 자동 빌드하려면 아래 단계를 따르세요.

## 1. 워크플로우 파일 추가

아래 내용을 `.github/workflows/build-ios.yml`로 저장하고 직접 push하세요:

```yaml
name: Build iOS IPA

on:
  push:
    branches: [ "main", "claude/*" ]
  workflow_dispatch:

env:
  XCODE_PROJECT: PokeRogue/PokeRogue.xcodeproj
  SCHEME: PokeRogue
  PRODUCT_NAME: PokeRogue

jobs:
  build:
    runs-on: macos-15
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_16.2.app/Contents/Developer

      - name: Install certificate and provisioning profile
        env:
          P12_BASE64: ${{ secrets.P12_BASE64 }}
          P12_PASSWORD: ${{ secrets.P12_PASSWORD }}
          PROVISIONING_PROFILE_BASE64: ${{ secrets.PROVISIONING_PROFILE_BASE64 }}
          KEYCHAIN_PASSWORD: ${{ github.run_id }}
        run: |
          # Decode certificate
          CERTIFICATE_PATH=$RUNNER_TEMP/build_certificate.p12
          echo -n "$P12_BASE64" | base64 --decode -o $CERTIFICATE_PATH

          # Decode provisioning profile
          PP_PATH=$RUNNER_TEMP/build_profile.mobileprovision
          echo -n "$PROVISIONING_PROFILE_BASE64" | base64 --decode -o $PP_PATH

          # Create temporary keychain
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

          # Import certificate to keychain
          security import $CERTIFICATE_PATH -P "$P12_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH
          security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security list-keychain -d user -s $KEYCHAIN_PATH

          # Install provisioning profile
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp $PP_PATH ~/Library/MobileDevice/Provisioning\ Profiles/

      - name: Build archive
        env:
          TEAM_ID: ${{ secrets.TEAM_ID }}
          BUNDLE_ID: ${{ secrets.BUNDLE_ID }}
        run: |
          xcodebuild archive \
            -project "$XCODE_PROJECT" \
            -scheme "$SCHEME" \
            -sdk iphoneos \
            -configuration Release \
            -archivePath $RUNNER_TEMP/PokeRogue.xcarchive \
            DEVELOPMENT_TEAM="$TEAM_ID" \
            PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
            CODE_SIGN_STYLE=Manual \
            CODE_SIGN_IDENTITY="Apple Distribution" \
            PROVISIONING_PROFILE_SPECIFIER="" \
            -allowProvisioningUpdates \
            COMPILER_INDEX_STORE_ENABLE=NO

      - name: Generate ExportOptions.plist
        env:
          TEAM_ID: ${{ secrets.TEAM_ID }}
          BUNDLE_ID: ${{ secrets.BUNDLE_ID }}
          PROVISIONING_PROFILE_NAME: ${{ secrets.PROVISIONING_PROFILE_NAME }}
        run: |
          cat > $RUNNER_TEMP/ExportOptions.plist <<PLIST
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
              <key>method</key>
              <string>ad-hoc</string>
              <key>teamID</key>
              <string>${TEAM_ID}</string>
              <key>signingStyle</key>
              <string>manual</string>
              <key>provisioningProfiles</key>
              <dict>
                  <key>${BUNDLE_ID}</key>
                  <string>${PROVISIONING_PROFILE_NAME}</string>
              </dict>
          </dict>
          </plist>
          PLIST

      - name: Export IPA
        run: |
          xcodebuild -exportArchive \
            -archivePath $RUNNER_TEMP/PokeRogue.xcarchive \
            -exportOptionsPlist $RUNNER_TEMP/ExportOptions.plist \
            -exportPath $RUNNER_TEMP/export

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: PokeRogue-${{ github.sha }}
          path: ${{ runner.temp }}/export/*.ipa
          retention-days: 30

      - name: Cleanup keychain
        if: always()
        run: |
          security delete-keychain $RUNNER_TEMP/app-signing.keychain-db || true
```

## 2. GitHub Secrets 설정

리포 **Settings → Secrets and variables → Actions → New repository secret**

| Secret 이름 | 설명 | 얻는 방법 |
|-------------|------|-----------|
| `TEAM_ID` | Apple Developer Team ID (10자리) | [Apple Developer 계정](https://developer.apple.com/account) → Membership |
| `BUNDLE_ID` | 앱 번들 ID | 예: `com.yourname.pokerogue` |
| `P12_BASE64` | 배포 인증서 (.p12) Base64 인코딩 | 아래 참고 |
| `P12_PASSWORD` | .p12 파일 비밀번호 | 인증서 내보내기 시 설정한 비밀번호 |
| `PROVISIONING_PROFILE_BASE64` | Provisioning Profile Base64 인코딩 | 아래 참고 |
| `PROVISIONING_PROFILE_NAME` | Provisioning Profile 이름 | Developer Portal에서 확인 |

## 3. 인증서 준비 (.p12)

### Mac 키체인에서 내보내기:
```bash
# 1. Keychain Access → "Apple Distribution" 인증서 → 우클릭 → 내보내기 (.p12)
# 2. Base64로 인코딩:
base64 -i Certificates.p12 | pbcopy
# 클립보드에 복사된 값을 P12_BASE64 시크릿에 붙여넣기
```

### 인증서가 없다면 새로 만들기:
```bash
# 1. CSR 생성
openssl req -nodes -newkey rsa:2048 -keyout private.key -out CertificateSigningRequest.certSigningRequest

# 2. Apple Developer Portal → Certificates → "+" → Apple Distribution
#    CSR 파일 업로드 → 인증서 다운로드 (.cer)

# 3. .cer → .p12 변환
openssl x509 -in distribution.cer -inform DER -out distribution.pem
openssl pkcs12 -export -out distribution.p12 -inkey private.key -in distribution.pem

# 4. Base64 인코딩
base64 -i distribution.p12 | pbcopy
```

## 4. Provisioning Profile 준비

```bash
# 1. Apple Developer Portal → Profiles → "+"
#    → Ad Hoc 선택
#    → App ID 선택 (없으면 먼저 생성: Identifiers → "+")
#    → 인증서 선택
#    → 본인 기기 선택 (Devices에 등록 필요)
#    → 프로필 이름 입력 → 다운로드

# 2. Base64 인코딩:
base64 -i profile.mobileprovision | pbcopy
# 클립보드에 복사된 값을 PROVISIONING_PROFILE_BASE64 시크릿에 붙여넣기
```

## 5. 기기 등록 (UDID)

Ad Hoc 배포를 위해 본인 기기의 UDID를 등록해야 합니다:

1. iPhone을 Mac에 연결
2. Finder(또는 iTunes)에서 기기 선택 → 시리얼 번호 클릭하면 UDID 표시
3. Apple Developer Portal → Devices → "+" → UDID 입력

## 6. 빌드 실행

Secrets 설정 + 워크플로우 push 후:
1. 코드를 push하면 자동 빌드
2. 또는 Actions 탭 → "Build iOS IPA" → "Run workflow" 수동 실행
3. 완료 후 Artifacts에서 IPA 다운로드
4. AltStore, Sideloadly 등으로 아이폰에 설치 (Ad Hoc이므로 7일 제한 없음!)
