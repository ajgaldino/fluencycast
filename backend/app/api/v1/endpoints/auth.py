from datetime import timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.user import User, UserProfile
from app.schemas.auth import LoginRequest, RegisterRequest, Token
from app.schemas.user import UserResponse

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    user_in: RegisterRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Register a new user and initialize their learning profile.
    """
    existing_user = db.query(User).filter(User.email == user_in.email.lower()).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists.",
        )

    user = User(
        email=user_in.email.lower(),
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
    )
    db.add(user)
    db.flush()

    # Create default learning profile
    profile = UserProfile(
        user_id=user.id,
        english_level="B1",
        goal="General English",
        daily_goal_minutes=30,
        current_streak=1
    )
    db.add(profile)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(
    login_in: LoginRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Authenticate user via JSON body and return JWT access token.
    """
    user = db.query(User).filter(User.email == login_in.email.lower()).first()
    if not user or not verify_password(login_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(user.id, expires_delta=access_token_expires)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login/access-token", response_model=Token)
def login_access_token(
    db: Session = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, for Swagger UI authorize button.
    """
    user = db.query(User).filter(User.email == form_data.username.lower()).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(user.id, expires_delta=access_token_expires)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def read_user_me(
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get current logged in user details and learning profile.
    """
    return current_user


@router.post("/password-recovery")
def recover_password(
    email: str,
    db: Session = Depends(get_db)
) -> Any:
    """
    Password Recovery stub.
    """
    return {"message": "Password recovery email sent if the account exists."}


@router.post("/reset-data")
def reset_user_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Deletes all videos, transcript segments, saved phrases, reviews,
    and study sessions for the authenticated user, resetting account to a clean slate.
    """
    from app.models.phrase import SavedPhrase, PhraseReview
    from app.models.video import Video, TranscriptSegment
    from app.models.study_session import StudySession

    # Delete reviews
    db.query(PhraseReview).filter(
        PhraseReview.saved_phrase_id.in_(
            db.query(SavedPhrase.id).filter(SavedPhrase.user_id == current_user.id)
        )
    ).delete(synchronize_session=False)

    # Delete saved phrases
    db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id).delete(synchronize_session=False)

    # Delete segments and videos
    db.query(TranscriptSegment).filter(
        TranscriptSegment.video_id.in_(
            db.query(Video.id).filter(Video.user_id == current_user.id)
        )
    ).delete(synchronize_session=False)
    db.query(Video).filter(Video.user_id == current_user.id).delete(synchronize_session=False)

    # Delete study sessions
    db.query(StudySession).filter(StudySession.user_id == current_user.id).delete(synchronize_session=False)

    # Reset profile stats
    if current_user.profile:
        current_user.profile.current_streak = 0
        current_user.profile.last_study_date = None

    db.commit()
    return {"message": "Todos os dados foram resetados do zero com sucesso."}

