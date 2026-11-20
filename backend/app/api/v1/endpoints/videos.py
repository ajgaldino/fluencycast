import json
import traceback
from typing import Any, Iterator, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.transcript import TranscriptSegment
from app.schemas.video import VideoCreate, VideoResponse, VideoDetailResponse
from app.schemas.phrase import SavedPhraseResponse
from app.services.youtube import (
    extract_video_id,
    get_video_metadata,
    fetch_transcript,
    segment_transcript,
    parse_transcript_text
)
from app.services.vocabulary import extract_keywords_for_video, iter_extract_keywords_for_video

router = APIRouter()


@router.get("/", response_model=List[VideoResponse])
def get_user_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 50,
) -> Any:
    """
    Retrieve all videos added by the current user.
    """
    videos = (
        db.query(Video)
        .filter(Video.user_id == current_user.id)
        .order_by(Video.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return videos


@router.post("/", response_model=VideoDetailResponse, status_code=status.HTTP_201_CREATED)
def create_video(
    video_in: VideoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Process and add a new YouTube video for study:
    1. Validate URL and extract video ID
    2. Check if already added by this user (if so, return it and ensure keywords extracted)
    3. Fetch metadata (title, channel, thumbnail)
    4. Fetch transcript and segment into clean sentences
    5. Save video and segments in database
    6. Automatically extract high-value vocabulary keywords into flashcards
    """
    try:
        video_id = extract_video_id(video_in.url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Check if user already added this video
    existing = (
        db.query(Video)
        .filter(Video.user_id == current_user.id, Video.youtube_id == video_id)
        .first()
    )
    if existing:
        # Check if existing video has keywords; if not, extract them
        try:
            extract_keywords_for_video(existing.id, current_user.id, db, max_keywords=None)
        except Exception as e:
            print(f"[Vocabulary] Error extracting keywords for existing video {existing.id}: {e}")
        return existing

    # 1. Fetch metadata
    meta = get_video_metadata(video_id)

    # 2. Fetch transcript & segment
    try:
        if video_in.raw_transcript and video_in.raw_transcript.strip():
            segments_data = parse_transcript_text(video_in.raw_transcript)
        else:
            raw_items = fetch_transcript(video_id)
            segments_data = segment_transcript(raw_items)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not segments_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não foi possível obter uma transcrição para este vídeo. Certifique-se de que o vídeo possui legendas ativadas no YouTube ou cole a transcrição manualmente."
        )

    duration = segments_data[-1]["end_time"] if segments_data else 0.0

    video = Video(
        user_id=current_user.id,
        youtube_id=video_id,
        url=f"https://www.youtube.com/watch?v={video_id}",
        title=meta["title"],
        channel=meta["channel"],
        thumbnail_url=meta["thumbnail_url"],
        duration=duration,
        category=video_in.category or "video",
        language="en"
    )
    db.add(video)
    db.flush()

    # Create transcript segments
    for seg in segments_data:
        db_segment = TranscriptSegment(
            video_id=video.id,
            sequence=seg["sequence"],
            text=seg["text"],
            start_time=seg["start_time"],
            end_time=seg["end_time"]
        )
        db.add(db_segment)

    db.commit()
    db.refresh(video)

    # Automatically extract key vocabulary words from this video and create WORD flashcards
    try:
        extract_keywords_for_video(video.id, current_user.id, db, max_keywords=None)
    except Exception as err:
        print(f"[Vocabulary] Error extracting keywords for new video {video.id}: {err}")

    return video


@router.post("/sync-all-keywords")
def sync_all_videos_keywords(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Extracts vocabulary from all sentences for all videos already registered by the user.
    """
    videos = db.query(Video).filter(Video.user_id == current_user.id).all()
    total_created = 0
    for v in videos:
        try:
            created = extract_keywords_for_video(v.id, current_user.id, db, max_keywords=None)
            total_created += len(created)
        except Exception as e:
            print(f"[Vocabulary] Error syncing keywords for video {v.id}: {e}")
    return {
        "message": f"Varredura concluída! {total_created} novas palavras foram extraídas de todas as frases dos seus vídeos.",
        "videos_processed": len(videos),
        "total_cards_created": total_created
    }


@router.post("/{id}/extract-keywords", response_model=List[SavedPhraseResponse])
def extract_video_keywords_endpoint(
    id: str,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Extract or refresh vocabulary keywords from all sentences of a video into flashcards.
    """
    video = (
        db.query(Video)
        .filter(Video.id == id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    created = extract_keywords_for_video(video.id, current_user.id, db, max_keywords=limit)
    return created


def _extract_keywords_sse_events(video_id: str, user_id: str, db: Session, start_pct: int = 58) -> Iterator[dict]:
    """Emit structured SSE progress dictionaries while extracting and translating video keywords."""
    try:
        for ev in iter_extract_keywords_for_video(video_id, user_id, db, max_keywords=None):
            stage = ev.get("stage")
            if stage == "keywords_found":
                yield {
                    "type": "progress",
                    "stage": "keywords",
                    "progress": start_pct,
                    "message": f"Encontrados {ev['total']} termos para flashcards. Traduzindo...",
                    "completed": ev["completed"],
                    "total": ev["total"],
                }
            elif stage == "translating":
                span = 95 - start_pct
                pct = start_pct + round(span * ev["completed"] / max(ev["total"], 1))
                yield {
                    "type": "progress",
                    "stage": "keywords",
                    "progress": min(pct, 95),
                    "message": f"Traduzindo vocabulário ({ev['completed']}/{ev['total']}): {ev['current_word']}",
                    "completed": ev["completed"],
                    "total": ev["total"],
                    "current_word": ev["current_word"],
                }
            elif stage == "keywords_done":
                keywords_count = len(ev.get("phrases", []))
                yield {
                    "type": "progress",
                    "stage": "keywords",
                    "progress": 96,
                    "message": f"{keywords_count} flashcards prontos!" if keywords_count else "Vocabulário verificado.",
                    "completed": ev.get("total", 0),
                    "total": ev.get("total", 0),
                    "keywords_count": keywords_count,
                }
    except Exception as err:
        print(f"[Vocabulary] Error extracting keywords during stream for video {video_id}: {err}")


@router.post("/stream")
def create_video_stream(
    video_in: VideoCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """
    Process a new YouTube video and stream real-time Server-Sent Events (SSE)
    describing each pipeline stage and flashcard translation progress.
    """
    user_id = current_user.id
    db_dep = request.app.dependency_overrides.get(get_db, get_db)

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    def event_generator() -> Iterator[str]:
        db_gen = db_dep()
        db = next(db_gen)
        try:
            yield sse({
                "type": "progress",
                "stage": "metadata",
                "progress": 8,
                "message": "Validando link do YouTube...",
            })

            video_id = extract_video_id(video_in.url)

            existing = (
                db.query(Video)
                .filter(Video.user_id == user_id, Video.youtube_id == video_id)
                .first()
            )
            if existing:
                segments_count = len(existing.segments)
                keywords_count = 0
                yield sse({
                    "type": "progress",
                    "stage": "keywords",
                    "progress": 60,
                    "message": "Vídeo já encontrado na biblioteca. Verificando flashcards...",
                    "segments_count": segments_count,
                })
                for ev in _extract_keywords_sse_events(existing.id, user_id, db, start_pct=62):
                    if "keywords_count" in ev:
                        keywords_count = ev["keywords_count"]
                    yield sse(ev)

                db.refresh(existing)
                yield sse({
                    "type": "complete",
                    "progress": 100,
                    "message": "Lição pronta!",
                    "keywords_count": keywords_count,
                    "segments_count": len(existing.segments),
                    "video": VideoDetailResponse.model_validate(existing).model_dump(mode="json"),
                })
                return

            yield sse({
                "type": "progress",
                "stage": "metadata",
                "progress": 15,
                "message": "Buscando título e miniatura no YouTube...",
            })
            meta = get_video_metadata(video_id)

            has_manual = bool(video_in.raw_transcript and video_in.raw_transcript.strip())
            yield sse({
                "type": "progress",
                "stage": "transcript",
                "progress": 28,
                "message": "Processando transcrição colada..." if has_manual else "Obtendo legendas do YouTube...",
                "detail": meta["title"],
            })

            if has_manual:
                segments_data = parse_transcript_text(video_in.raw_transcript or "")
            else:
                raw_items = fetch_transcript(video_id)
                segments_data = segment_transcript(raw_items)

            if not segments_data:
                yield sse({
                    "type": "error",
                    "message": "Não foi possível obter uma transcrição para este vídeo. Certifique-se de que o vídeo possui legendas ativadas no YouTube ou cole a transcrição manualmente.",
                })
                return

            segments_count = len(segments_data)
            yield sse({
                "type": "progress",
                "stage": "saving",
                "progress": 45,
                "message": f"Salvando vídeo e {segments_count} frases sincronizadas no banco...",
                "detail": meta["title"],
                "segments_count": segments_count,
            })

            duration = segments_data[-1]["end_time"] if segments_data else 0.0
            video = Video(
                user_id=user_id,
                youtube_id=video_id,
                url=f"https://www.youtube.com/watch?v={video_id}",
                title=meta["title"],
                channel=meta["channel"],
                thumbnail_url=meta["thumbnail_url"],
                duration=duration,
                category=video_in.category or "video",
                language="en"
            )
            db.add(video)
            db.flush()

            for seg in segments_data:
                db.add(TranscriptSegment(
                    video_id=video.id,
                    sequence=seg["sequence"],
                    text=seg["text"],
                    start_time=seg["start_time"],
                    end_time=seg["end_time"]
                ))

            db.commit()
            db.refresh(video)

            yield sse({
                "type": "progress",
                "stage": "keywords",
                "progress": 55,
                "message": "Analisando expressões e palavras-chave do vídeo...",
                "segments_count": segments_count,
            })

            keywords_count = 0
            for ev in _extract_keywords_sse_events(video.id, user_id, db, start_pct=58):
                if "keywords_count" in ev:
                    keywords_count = ev["keywords_count"]
                yield sse(ev)

            yield sse({
                "type": "progress",
                "stage": "finalizing",
                "progress": 98,
                "message": "Finalizando lição e sincronização...",
                "segments_count": segments_count,
                "keywords_count": keywords_count,
            })

            db.refresh(video)
            yield sse({
                "type": "complete",
                "progress": 100,
                "message": "Lição e flashcards prontos!",
                "keywords_count": keywords_count,
                "segments_count": segments_count,
                "video": VideoDetailResponse.model_validate(video).model_dump(mode="json"),
            })
        except ValueError as err:
            yield sse({"type": "error", "message": str(err)})
        except Exception as err:
            print(f"[Videos Stream] Unexpected error: {err}\n{traceback.format_exc()}")
            yield sse({"type": "error", "message": f"Erro ao processar vídeo: {str(err)}"})
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



@router.get("/{id}", response_model=VideoDetailResponse)
def get_video_by_id(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get a specific video by ID with all synchronized transcript segments.
    """
    video = (
        db.query(Video)
        .filter(Video.id == id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Delete a video and its segments.
    """
    video = (
        db.query(Video)
        .filter(Video.id == id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    db.delete(video)
    db.commit()
