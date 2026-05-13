import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";

export const handler = async (event) => {
  const clusterName = process.env.ECS_CLUSTER_NAME;
  const serviceName = process.env.ECS_SERVICE_NAME;

  if (!clusterName || !serviceName) {
    throw new Error("Missing ECS_CLUSTER_NAME or ECS_SERVICE_NAME environment variables");
  }

  console.log("Received CloudWatch alarm event", JSON.stringify(event));
  console.log(`Forcing ECS deployment for cluster=${clusterName} service=${serviceName}`);

  const ecs = new ECSClient({});
  const command = new UpdateServiceCommand({
    cluster: clusterName,
    service: serviceName,
    forceNewDeployment: true,
  });

  const response = await ecs.send(command);
  console.log("ECS force deployment triggered", JSON.stringify(response.service?.deployments || []));

  return {
    ok: true,
    clusterName,
    serviceName,
  };
};
