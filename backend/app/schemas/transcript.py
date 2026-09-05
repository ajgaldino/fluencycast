from pydantic import BaseModel, ConfigDict


class TranscriptSegmentBase(BaseModel):
    sequence: int
    text: str
    start_time: float
    end_time: float


class TranscriptSegmentResponse(TranscriptSegmentBase):
    id: str
    video_id: str

    model_config = ConfigDict(from_attributes=True)
