export const fetchPrescriptiveAnalysis = async (
  userQuestion: any,
  restfulService: string,
  extensionSDK: any,
): Promise<any> => {
  console.log('fetchPrescriptiveAnalysis userQuestion', userQuestion);
  console.log(restfulService)

  try {
    const response = await extensionSDK[restfulService === 'http://localhost:5000' ? 'fetchProxy' : 'serverProxy'](`${restfulService}/generatePerspectiveAnalytics`, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: userQuestion,
        client_secret: restfulService === 'http://localhost:5000' ? process.env.GENAI_CLIENT_SECRET : extensionSDK.createSecretKeyTag("genai_client_secret")
      })
    });
    console.log('fetchPrescriptiveAnalysis response', response);
    if (response.ok) {
      const data = await response.body;
      return data;
    } else {
      console.error('Error generating prescriptive analysis:', response.statusText);
      return null;
    }
  } catch (error) {
    console.error('Error generating prescriptive analysis:', error);
    return null;
  }
};
