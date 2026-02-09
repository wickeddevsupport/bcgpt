import { Static, Type } from '@sinclair/typebox'
import { EmailType, PasswordType } from '../../user/user'

export enum OtpType {
    EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
    PASSWORD_RESET = 'PASSWORD_RESET',
}

export const CreateOtpRequestBody = Type.Object({
    email: EmailType,
    type: Type.Enum(OtpType),
})
export type CreateOtpRequestBody = Static<typeof CreateOtpRequestBody>

export const VerifyEmailRequestBody = Type.Object({
    otp: Type.String(),
    identityId: Type.String(),
})
export type VerifyEmailRequestBody = Static<typeof VerifyEmailRequestBody>

export const ResetPasswordRequestBody = Type.Object({
    otp: Type.String(),
    identityId: Type.String(),
    newPassword: PasswordType,
})
export type ResetPasswordRequestBody = Static<typeof ResetPasswordRequestBody>

