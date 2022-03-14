import _ from "radash"
import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import fs from "fs-extra"
import type { DeploymentContext } from "@exobase/client-js"
import { AWSLambdaAPI } from "@exobase/pulumi-aws-lambda-api"
import { getFunctionMap } from '@exobase/builds'
import path from "path"
import cmd from 'cmdish'

type Config = {
  timeout: number
  memory: number
}

type Outputs = {
  url: pulumi.Output<string> | string
}

const main = async ({
  workingDir,
}: {
  workingDir: string
}): Promise<Outputs> => {
  //
  //  READ PROJECT CONFIG
  //
  const context = (await fs.readJSON(
    path.join(workingDir, "context.json")
  )) as DeploymentContext
  const { platform, service, deployment } = context
  const config = deployment.config.stack as Config

  //
  //  SETUP PROVIDER
  //
  const provider = new aws.Provider("aws", {
    secretKey: platform.providers.aws.accessKeySecret,
    accessKey: platform.providers.aws.accessKeyId,
    region: platform.providers.aws.region as aws.Region,
  })

  //
  //  READ FUNCTIONS
  //
  const functions = getFunctionMap({
    path: path.resolve(workingDir, 'source'),
    ext: 'ts'
  })

  //
  //  EXECUTE BUILD
  //
  await onlyOnce('build', async () => {
    await cmd('yarn && yarn build', { cwd: path.resolve(workingDir, 'source') })
    return true // cached value
  })()

  //
  //  CREATE API/LAMBDA RESOURCES
  //
  const envVarDict = deployment.config.environmentVariables.reduce((acc, ev) => ({
    ...acc,
    [ev.name]: ev.value,
  }), {})
  const api = new AWSLambdaAPI(_.dashCase(service.name), {
    sourceDir: path.join(workingDir, "source"),
    sourceExt: "ts",
    runtime: "nodejs14.x",
    functions,
    getZip: (func) => {
      return new pulumi.asset.FileArchive(
        path.resolve(workingDir, 'source', 'build', 'modules', func.module, `${func.function}.zip`)
      )
    },
    getHandler: (func) => `${func.function}.default`,
    timeout: toNumber(config.timeout),
    memory: toNumber(config.memory),
    environmentVariables: {
      ...envVarDict,
      EXOBASE_PLATFORM: platform.name,
      EXOBASE_SERVICE: service.name,
    },
    domain: service.domain,
  }, { provider })

  return {
    url: service.domain ? service.domain.fqd : api.api.url,
  }
}

const toNumber = (value: string | number): number => {
  if (_.isString(value)) return parseInt(value as string)
  return value as number
}

const onlyOnce = <T> (key: string, func: () => Promise<T>) => async (): Promise<T> => {
  const cacheFilePath = path.resolve(process.cwd(), '.exo-operation-cache')
  console.log('x--> ONLY ONCE:', cacheFilePath)
  const cache = await (async () => {
    const [notExists, existing] = await _.try(() => fs.readJSON(cacheFilePath))()
    console.log({ notExists, existing })
    if (!notExists) return existing
    await fs.writeJSON(cacheFilePath, {})
    return {}
  })()
  if (cache[key]) return cache[key]
  const [err, result] = await _.try(func)()
  console.log({ err, result})
  await fs.writeJSON(cacheFilePath, { ...cache, [key]: result })
  if (err) throw err
  else return result
}

export default main