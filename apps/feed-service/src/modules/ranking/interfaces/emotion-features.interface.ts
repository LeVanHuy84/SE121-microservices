/**
 * Emotion features consumed by feed ranking from analysis-service.
 */
export interface EmotionFeatures {
  userEmotionPreference: Record<string, number>;
  last24hEmotionDistribution: Record<string, number>;
  negativeRatio7d: number;
  emotionVolatility7d: number;
  riskScore: number;
  negativeStreak: number;
}

export interface EmotionFeaturesResponse {
  userId: string;
  features: EmotionFeatures;
}

/*
Example EmotionFeatures object:
{
    "userId": "user_34yN7jxT40bXpcnozg2UVOKDbzK",
    "features": {
        "userEmotionPreference": {
            "joy": 0.7460205509130302,
            "sadness": 0.019259597647787067,
            "anger": 0.036990974930362124,
            "fear": 0.0033660414732281044,
            "disgust": 0.00321814917982049,
            "surprise": 0.0005422717424945839,
            "neutral": 0.19060241411327766
        },
        "last24hEmotionDistribution": {
            "joy": 0.010921028877061954,
            "sadness": 0.8522524451868695,
            "anger": 0.007217766247198779,
            "fear": 0.008583254921930251,
            "disgust": 0.014276361449236026,
            "surprise": 0.008303683438803966,
            "neutral": 0.09844545987889927
        },
        "negativeRatio7d": 0.0,
        "emotionVolatility7d": 0.07296152951164692,
        "riskScore": 0.021888458853494074,
        "negativeStreak": 0
    }
}
*/
