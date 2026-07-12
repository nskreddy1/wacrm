import { NextResponse } from "next/server"
import { createContact, createField, deleteContacts, getContactStore, updateContact, updatePreferences } from "@/lib/demo/contact-repository"

export async function GET() {
  return NextResponse.json({ data: getContactStore(), meta: { source: "seeded-enterprise-demo" } })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (body.kind === "field") return NextResponse.json({ data: createField(body.field) }, { status: 201 })
    return NextResponse.json({ data: createContact(body.values ?? {}) }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Unable to create record" } }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    if (body.kind === "preferences") return NextResponse.json({ data: updatePreferences(body.preferences ?? {}) })
    if (!body.id) throw new Error("A contact id is required")
    return NextResponse.json({ data: updateContact(body.id, body.values ?? {}) })
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Unable to save changes" } }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  const body = await request.json()
  const ids = Array.isArray(body.ids) ? body.ids : []
  deleteContacts(ids)
  return NextResponse.json({ data: { deleted: ids.length } })
}
