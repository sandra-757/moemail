import { NextResponse } from "next/server"
import { register } from "@/lib/auth"
import { authSchema, AuthSchema } from "@/lib/validation"
import { verifyTurnstileToken } from "@/lib/turnstile"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { parseConfigBool, SITE_CONFIG_DEFAULTS } from "@/lib/site-config"

export const runtime = "edge"

export async function POST(request: Request) {
  try {
    const allowRegistration = parseConfigBool(
      await getRequestContext().env.SITE_CONFIG.get("ALLOW_REGISTRATION"),
      SITE_CONFIG_DEFAULTS.ALLOW_REGISTRATION
    )
    if (!allowRegistration) {
      return NextResponse.json(
        { error: "当前已关闭公开注册" },
        { status: 403 }
      )
    }

    const json = await request.json() as AuthSchema
    
    try {
      authSchema.parse(json)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "输入格式不正确" },
        { status: 400 }
      )
    }

    const { username, password, turnstileToken } = json

    const verification = await verifyTurnstileToken(turnstileToken)
    if (!verification.success) {
      const message = verification.reason === "missing-token"
        ? "请先完成安全验证"
        : "安全验证未通过"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const user = await register(username, password)

    return NextResponse.json({ user })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 500 }
    )
  }
} 
