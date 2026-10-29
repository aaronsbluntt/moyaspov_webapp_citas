import { NextRequest, NextResponse } from "next/server";
import {
  addEventNote,
  deleteEventNote,
  getEventNotes,
  updateEventNote,
} from "@/lib/services/events";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const notes = await getEventNotes(id);
    return NextResponse.json({ notes });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al obtener notas",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const note = await addEventNote({
      eventId: id,
      content: body.content,
      noteType: body.note_type || body.noteType || "comment",
      authorId: body.author_id || body.authorId,
      isPinned: body.is_pinned ?? body.isPinned ?? false,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al agregar nota",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const updated = await updateEventNote(body.noteId, {
      content: body.content,
      noteType: body.noteType,
      isPinned: body.isPinned,
    });
    return NextResponse.json({ note: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al actualizar nota",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const noteId = searchParams.get("noteId");
    if (!noteId) {
      return NextResponse.json(
        { error: "Se requiere el parámetro noteId" },
        { status: 400 }
      );
    }
    const result = await deleteEventNote(noteId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al eliminar nota",
      },
      { status: 500 }
    );
  }
}
