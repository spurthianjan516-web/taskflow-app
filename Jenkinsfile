pipeline {
  agent any

  environment {
    APP_NAME        = "taskflow-app"
    DOCKER_IMAGE    = "/taskflow-app"
    DOCKER_TAG      = "${BUILD_NUMBER}"
    HELM_CHART      = "helm/taskflow"
    RELEASE_NAME    = "taskflow"
    STAGING_NS      = "staging"
    PROD_NS         = "production"
  }

  options {
    buildDiscarder(logRotator(numToKeepStr: '10'))
    timeout(time: 45, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT = sh(
            script: 'git rev-parse --short HEAD',
            returnStdout: true
          ).trim()
          echo "Branch : ${env.BRANCH_NAME}"
          echo "Commit : ${env.GIT_SHORT}"
        }
      }
      post {
        success { echo "✅ CHECKPOINT 1: Code checked out — ${env.GIT_SHORT}" }
        failure { error "❌ CHECKPOINT 1 FAILED: Cannot checkout code" }
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'npm ci'
      }
      post {
        success { echo "✅ CHECKPOINT 2: Dependencies installed" }
        failure { error "❌ CHECKPOINT 2 FAILED: npm ci failed" }
      }
    }

    stage('Unit Tests') {
      steps {
        sh 'npm test'
      }
      post {
        success { echo "✅ CHECKPOINT 3: All tests passed" }
        failure { error "❌ CHECKPOINT 3 FAILED: Tests failed" }
      }
    }

    stage('Docker Build') {
      steps {
        sh """
          docker build \
            --build-arg GIT_COMMIT=${env.GIT_SHORT} \
            --build-arg VERSION=${DOCKER_TAG} \
            -t ${DOCKER_IMAGE}:${env.GIT_SHORT} \
            -t ${DOCKER_IMAGE}:latest \
            .
        """
        sh "docker images ${DOCKER_IMAGE} | head -3"
      }
      post {
        success { echo "✅ CHECKPOINT 4: Docker image built — ${DOCKER_IMAGE}:${env.GIT_SHORT}" }
        failure { error "❌ CHECKPOINT 4 FAILED: Docker build failed" }
      }
    }

    stage('Push Image') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'dockerhub-credentials',
          usernameVariable: 'DOCKER_USER',
          passwordVariable: 'DOCKER_PASS'
        )]) {
          sh """
            echo \$DOCKER_PASS | docker login \
              -u \$DOCKER_USER --password-stdin
            docker push ${DOCKER_IMAGE}:${env.GIT_SHORT}
            docker push ${DOCKER_IMAGE}:latest
          """
        }
      }
      post {
        success { echo "✅ CHECKPOINT 5: Image pushed to DockerHub" }
        failure { error "❌ CHECKPOINT 5 FAILED: Docker push failed" }
      }
    }

    stage('Helm Lint') {
      steps {
        sh """
          helm lint ${HELM_CHART} \
            -f ${HELM_CHART}/values.yaml \
            -f ${HELM_CHART}/values-staging.yaml
        """
      }
      post {
        success { echo "✅ CHECKPOINT 6: Helm chart valid" }
        failure { error "❌ CHECKPOINT 6 FAILED: Helm lint failed" }
      }
    }

    stage('Deploy to Staging') {
      steps {
        sh """
          helm upgrade --install ${RELEASE_NAME} ${HELM_CHART} \
            --namespace ${STAGING_NS} \
            -f ${HELM_CHART}/values.yaml \
            -f ${HELM_CHART}/values-staging.yaml \
            --set image.tag=${env.GIT_SHORT} \
            --atomic \
            --cleanup-on-fail \
            --timeout 5m \
            --wait
        """
        sh """
          kubectl rollout status deployment/${RELEASE_NAME} \
            -n ${STAGING_NS} --timeout=3m
        """
        sh "kubectl get pods -n ${STAGING_NS}"
      }
      post {
        success { echo "✅ CHECKPOINT 7: Staging deployed successfully" }
        failure { error "❌ CHECKPOINT 7 FAILED: Staging deploy failed" }
      }
    }

    stage('Smoke Tests') {
      steps {
        sh """
          kubectl port-forward svc/${RELEASE_NAME} 8888:80 \
            -n ${STAGING_NS} &
          PF_PID=\$!
          sleep 8

          echo "--- Health Check ---"
          curl --max-time 10 -f http://localhost:8888/health

          echo "--- Ready Check ---"
          curl --max-time 10 -f http://localhost:8888/ready

          echo "--- Tasks API ---"
          curl --max-time 10 -f http://localhost:8888/tasks

          echo "--- Metrics ---"
          curl --max-time 10 -f http://localhost:8888/metrics | head -3

          kill \$PF_PID || true
          echo "✅ All smoke tests passed"
        """
      }
      post {
        success { echo "✅ CHECKPOINT 8: Smoke tests passed" }
        failure { error "❌ CHECKPOINT 8 FAILED: Smoke tests failed" }
      }
    }

    stage('Approve Production') {
      when { branch 'main' }
      steps {
        timeout(time: 30, unit: 'MINUTES') {
          input(
            message: "Deploy taskflow-app:${env.GIT_SHORT} to PRODUCTION?",
            ok: 'Deploy to Production'
          )
        }
      }
      post {
        success { echo "✅ CHECKPOINT 9: Production approved" }
        aborted { error "❌ CHECKPOINT 9: Rejected" }
      }
    }

    stage('Deploy to Production') {
      when { branch 'main' }
      steps {
        sh """
          helm upgrade --install ${RELEASE_NAME} ${HELM_CHART} \
            --namespace ${PROD_NS} \
            -f ${HELM_CHART}/values.yaml \
            -f ${HELM_CHART}/values-production.yaml \
            --set image.tag=${env.GIT_SHORT} \
            --atomic \
            --cleanup-on-fail \
            --timeout 10m \
            --history-max 10 \
            --wait
        """
        sh """
          kubectl rollout status deployment/${RELEASE_NAME} \
            -n ${PROD_NS} --timeout=5m
        """
        sh "kubectl get pods -n ${PROD_NS} -o wide"
      }
      post {
        success { echo "✅ CHECKPOINT 10: Production deployed!" }
        failure { error "❌ CHECKPOINT 10 FAILED: Production deploy failed" }
      }
    }
  }

  post {
    success {
      echo "🎉 PIPELINE COMPLETE — taskflow-app deployed successfully!"
    }
    failure {
      echo "❌ PIPELINE FAILED — check stage logs above"
    }
    always {
      sh 'docker logout || true'
      cleanWs()
    }
  }
}
