from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.messaging.event_dispatcher import RecommendationEventDispatcher
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler
from app.messaging.recommendation_graph_event_handler import (
    RecommendationGraphEventHandler,
)
from app.messaging.runtime import RecommendationMessagingRuntime
from app.processors.recommendation_outbox_processor import (
    RecommendationOutboxProcessor,
)
from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.precompute_queue import precompute_queue
from app.services.precompute_service import RecommendationPrecomputeService
from app.services.recommendation_query_service import RecommendationQueryService
from app.services.rerank_service import rerank_service

state_repository = RecommendationStateRepository(settings.DATABASE_URL)
recommendation_precompute_service = RecommendationPrecomputeService(
    state_repository,
)
recommendation_query_service = RecommendationQueryService(
    state_repository,
    rerank_service,
)
recommendation_state_processor = RecommendationStateProcessor(
    precompute_queue,
    recommendation_precompute_service,
)

producer = KafkaProducerService(settings.KAFKA_BROKERS)
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
outbox_processor = RecommendationOutboxProcessor(state_repository, producer)
messaging_runtime = RecommendationMessagingRuntime(
    producer=producer,
    consumers=[profile_consumer, graph_consumer],
    state_processor=recommendation_state_processor,
    outbox_processor=outbox_processor,
)
