import _ from "radash"
import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import fs from "fs-extra"
import type { DeploymentContext } from "@exobase/client-js"
import { AWSLambdaAPI } from "@exobase/pulumi-aws-lambda-api"
import { ModuleFunction, getFunctionMap } from '@exobase/builds'
import path from "path"
import cmd from 'cmdish'
import webpack from 'webpack'
import TerserPlugin from 'terser-webpack-plugin'

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

  console.log('x--> CONTEXT:')
  console.log(JSON.stringify(context, null, 2))

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

  console.log('x--> FUNCTIONS:')
  console.log(functions)

  //
  //  EXECUTE BUILD
  //
  await cmd('yarn && yarn build', { cwd: path.resolve(workingDir, 'source') })
  // await executeBuild(functions, path.resolve(workingDir, 'source'))

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


const executeBuild = async (functions: ModuleFunction[], sourceDir: string): Promise<void> => {
  await cmd('rm -rf build', { cwd: sourceDir })
  const execute = async (func: ModuleFunction) => {
    console.log(`processing: ${func.module}/${func.function}.js`)
    await compile(func, sourceDir)
    console.log(`compiled: ${func.module}/${func.function}.js`)
    await zip(func, sourceDir)
    console.log(`zipped: ${func.module}/${func.function}.js -> ${func.module}/${func.function}.zip`)
  }
  await (Promise as any).allSettled([functions[0]].map(f => execute(f)))
}

const compile = async (func: ModuleFunction, sourceDir: string) => {
  await new Promise<void>((res, rej) => {
    webpack(
      {
        entry: [path.resolve(sourceDir, `src/modules/${func.module}/${func.function}.ts`)],
        mode: (process.env.NODE_ENV as 'production' | 'development') ?? 'production',
        target: 'node',
        output: {
          path: path.resolve(sourceDir, 'build', 'modules', func.module),
          filename: `${func.function}.js`
        },
        resolve: {
          extensions: ['.ts', '.js']
        },
        module: {
          rules: [
            {
              test: /\.ts$/,
              use: ['ts-loader']
            }
          ]
        },
        optimization: {
          minimizer: [
            new TerserPlugin({
              extractComments: false
            })
          ]
        }
      },
      (err, stats) => {
        console.log('x--> WEBPACK COMPLETE:')
        console.log(stats)
        if (err || stats.hasErrors()) rej(err ?? { message: 'Webpack stats has error' })
        else res()
      }
    )
  })
}

const zip = async (func: ModuleFunction, sourceDir: string) => {
  await cmd(`zip -q ${func.function}.zip ${func.function}.js`, {
    cwd: path.resolve(sourceDir, 'build', 'modules', func.module)
  })
}

export default main