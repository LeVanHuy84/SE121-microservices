from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.messaging.event_dispatcher import RecommendationEventDispatcher
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler
from app.messaging.recommendation_graph_event_handler import (
    RecommendationGraphEventHandler,
)
from app.messaging.runtime import RecommendationMessagingRuntime
from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.global_fallback_batch_service import GlobalFallbackBatchService
from app.services.precompute_queue import precompute_queue
from app.services.precompute_service import RecommendationPrecomputeService
from app.services.query_service import QueryService
from app.services.rerank_service import rerank_service

state_repository = RecommendationStateRepository(settings.DATABASE_URL)
recommendation_precompute_service = RecommendationPrecomputeService(
    state_repository,
)
global_fallback_batch_service = GlobalFallbackBatchService(state_repository)
recommendation_query_service = QueryService(
    state_repository,
    rerank_service,
)
recommendation_state_processor = RecommendationStateProcessor(
    precompute_queue,
    recommendation_precompute_service,
    global_fallback_batch_service,
)

profile_handler = ProfileEmbeddingEventHandler(state_repository, precompute_queue)
graph_handler = RecommendationGraphEventHandler(
    state_repository,
    precompute_queue,
)
dispatcher = RecommendationEventDispatcher(profile_handler, graph_handler)
profile_consumer = KafkaConsumerService(
    brokers=settings.KAFKA_BROKERS,
    topic=settings.RECOMMENDATION_PROFILE_TOPIC,
    group_id=settings.KAFKA_GROUP_ID,
    handler=dispatcher.dispatch,
)
graph_consumer = KafkaConsumerService(
    brokers=settings.KAFKA_BROKERS,
    topic=settings.RECOMMENDATION_GRAPH_TOPIC,
    group_id=settings.KAFKA_GROUP_ID,
    handler=dispatcher.dispatch,
)
messaging_runtime = RecommendationMessagingRuntime(
    consumers=[profile_consumer, graph_consumer],
    state_processor=recommendation_state_processor,
)
