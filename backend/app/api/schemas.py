from pydantic import BaseModel, EmailStr, Field

# request from the registration
class UserRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8)
    bank_account_id: str = Field(min_length=3, max_length=50)

# request from the login
class UserLogin(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = None
    recovery_code: str | None = None

# respond for registreation
class UserOut(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    bank_account_id: str | None

    class Config:
        from_attributes = True

# respond for login
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

# create transaction
class TransactionCreate(BaseModel):
    reference: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)

# respond for trasaction creation
class TransactionOut(BaseModel):
    id: str
    reference: str
    amount: float
    status: str

    class Config:
        from_attributes = True

# respond for wallets
class WalletOut(BaseModel):
    id: str
    wallet_type: str
    balance: float

    class Config:
        from_attributes = True

# respond for rulles
class RuleOut(BaseModel):
    id: str
    name: str
    rule_type: str
    target_wallet: str
    priority: int
    fixed_amount: float | None
    percentage: float | None
    condition_field: str | None
    condition_operator: str | None
    condition_value: float | None
    is_active: bool

    class Config:
        from_attributes = True


# respond for 2FA
class TwoFactorSetupOut(BaseModel):
    secret: str
    provisioning_uri: str

# request from 2FA
class TwoFactorVerify(BaseModel):
    code: str = Field(min_length=6, max_length=6)

class LinkBankAccount(BaseModel):
    bank_account_id: str = Field(min_length=3, max_length=50)

class OnboardingRulesUpdate(BaseModel):
    rent_amount: float = Field(ge=0)
    tax_percent: float = Field(ge=0, le=100)
    savings_percent: float = Field(ge=0, le=100)
    savings_cap: float = Field(ge=0)


class OAuthExchangeRequest(BaseModel):
    code: str



class ResendVerificationRequest(BaseModel):
    email: EmailStr


class VerifyEmailRequest(BaseModel):
    token: str


class MessageResponse(BaseModel):
    message: str

class RecoveryCodesOut(BaseModel):
    message: str
    recovery_codes: list[str]

class RegenerateRecoveryCodesRequest(BaseModel):
    password: str
    totp_code: str


class DisableTwoFactorRequest(BaseModel):
    password: str
    totp_code: str | None = None
    recovery_code: str | None = None