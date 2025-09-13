export interface ClerkJwtClaims {
    sub: string;        // userId
    email?: string;     // optional nếu có bật claim email
    roles?: string[];   // optional nếu bạn custom trong JWT template
    iat?: number;       // issued at
    exp?: number;       // expired at
}
